/**
 * Rich email body validator — the security spine.
 *
 * Parses and validates the client-supplied serialized ProseMirror JSON
 * (`bodyJson`) BEFORE it is ever rendered to HTML. It fails closed: any unknown
 * node/mark type, disallowed heading level, disallowed URL scheme, oversized
 * payload, malformed JSON, or excessive nesting throws a structured
 * `ConvexError` (INVALID_INPUT). Unknown attributes are stripped so nothing but
 * an explicit per-node/per-mark whitelist survives into the rendered output
 * (defeats `onerror`-style attribute injection).
 *
 * The allowlists live in `@shared/email/rich-text-schema` and are shared with
 * the render factory and the frontend editor factory.
 */
import {isRecord} from '@shared/type-guards';
import {MAX_RICH_EMAIL_BODY_JSON_BYTES} from '@shared/constants';
import {
  RICH_TEXT_HEADING_LEVEL_SET,
  RICH_TEXT_LINK_URL_SCHEMES,
  RICH_TEXT_MARK_TYPE_SET,
  RICH_TEXT_NODE_TYPE_SET,
} from '@shared/email/rich-text-schema';
import {throwInvalidInput} from '../errors';

/** Defense-in-depth caps on the parsed tree (byte + text caps already bound it). */
const MAX_NODE_COUNT = 5000;
const MAX_NODE_DEPTH = 100;

/**
 * Strips ASCII C0 (0x00–0x1F) and C1 (0x7F–0x9F) control characters from a
 * string. Applied to URLs before scheme detection so a smuggled control char
 * (e.g. `java\tscript:`, which browsers ignore) cannot bypass the scheme
 * allowlist. Uses char-code checks rather than a control-character regex
 * literal (which the linter rejects) so no rule suppression is needed.
 */
function stripControlChars(value: string): string {
  let result = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    if (!isControl) {
      result += char;
    }
  }
  return result;
}

export interface RichTextMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: RichTextMark[];
  content?: RichTextNode[];
  text?: string;
}

export interface RichBodyDoc extends RichTextNode {
  type: 'doc';
}

/**
 * Extracts and validates a URL's scheme against an allowlist.
 *
 * Rejects relative URLs (no scheme), scheme-relative URLs (`//host`), and any
 * scheme outside `allowedSchemes`. Control characters (which browsers strip and
 * which can be used to smuggle `java\tscript:`) are removed before scheme
 * detection. Returns the sanitized URL string.
 */
function assertAllowedUrl(
  rawUrl: unknown,
  allowedSchemes: readonly string[],
  field: string,
): string {
  if (typeof rawUrl !== 'string') {
    throwInvalidInput(`${field} must be a string`, {field});
  }
  // Strip control characters, then trim surrounding whitespace, before scheme
  // detection so `java\tscript:` cannot smuggle a disallowed scheme through.
  const sanitized = stripControlChars(rawUrl).trim();
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(sanitized);
  if (!match) {
    // No scheme => relative or scheme-relative (`//host`) => reject.
    throwInvalidInput(
      `${field} must be an absolute URL with an allowed scheme`,
      {field},
    );
  }
  const scheme = match[1].toLowerCase();
  if (!allowedSchemes.includes(scheme)) {
    throwInvalidInput(`${field} uses a disallowed URL scheme`, {field, scheme});
  }
  return sanitized;
}

function validateMark(raw: unknown): RichTextMark {
  if (!isRecord(raw)) {
    throwInvalidInput('Invalid message content mark');
  }
  const type = raw['type'];
  if (typeof type !== 'string' || !RICH_TEXT_MARK_TYPE_SET.has(type)) {
    throwInvalidInput(
      `Disallowed message content mark type: ${
        typeof type === 'string' ? type : 'unknown'
      }`,
    );
  }
  const mark: RichTextMark = {type};
  if (type === 'link') {
    const attrs = isRecord(raw['attrs']) ? raw['attrs'] : {};
    mark.attrs = {
      href: assertAllowedUrl(
        attrs['href'],
        RICH_TEXT_LINK_URL_SCHEMES,
        'Link href',
      ),
    };
  }
  return mark;
}

function validateNode(
  raw: unknown,
  depth: number,
  counter: {count: number},
): RichTextNode {
  counter.count += 1;
  if (counter.count > MAX_NODE_COUNT) {
    throwInvalidInput('Message content has too many nodes');
  }
  if (depth > MAX_NODE_DEPTH) {
    throwInvalidInput('Message content is nested too deeply');
  }
  if (!isRecord(raw)) {
    throwInvalidInput('Invalid message content node');
  }
  const type = raw['type'];
  if (typeof type !== 'string' || !RICH_TEXT_NODE_TYPE_SET.has(type)) {
    throwInvalidInput(
      `Disallowed message content node type: ${
        typeof type === 'string' ? type : 'unknown'
      }`,
    );
  }

  const node: RichTextNode = {type};

  // Per-type attribute whitelist. Any attribute not read here is dropped.
  if (type === 'heading') {
    const attrs = isRecord(raw['attrs']) ? raw['attrs'] : {};
    const level = attrs['level'];
    if (typeof level !== 'number' || !RICH_TEXT_HEADING_LEVEL_SET.has(level)) {
      throwInvalidInput(
        `Disallowed heading level: ${
          typeof level === 'number' ? level : 'unknown'
        }`,
      );
    }
    node.attrs = {level};
  } else if (type === 'image') {
    // Images must reference one of OUR confirmed uploads by storage id — never a
    // client-supplied URL. A raw `src` is rejected outright (dropped): accepting
    // it would let a client embed an arbitrary remote host (tracking pixel /
    // third-party image) into emails sent to ticket holders. The storage id is
    // verified against `confirmedUploads` in a separate ctx-aware step in each
    // send handler; here we only enforce the structural contract. The renderer
    // resolves the id to a durable, server-owned `src` (`/api/images/{id}`).
    const attrs = isRecord(raw['attrs']) ? raw['attrs'] : {};
    const storageId = attrs['storageId'];
    if (typeof storageId !== 'string' || storageId.trim().length === 0) {
      throwInvalidInput('Image is missing a storageId', {
        field: 'Image storageId',
      });
    }
    const alt = typeof attrs['alt'] === 'string' ? attrs['alt'] : '';
    node.attrs = {storageId, alt};
  }

  if (type === 'text') {
    if (typeof raw['text'] !== 'string') {
      throwInvalidInput('Text node is missing its text');
    }
    node.text = raw['text'];
  }

  if (raw['marks'] !== undefined) {
    if (!Array.isArray(raw['marks'])) {
      throwInvalidInput('Invalid message content marks');
    }
    node.marks = raw['marks'].map((mark) => validateMark(mark));
  }

  if (raw['content'] !== undefined) {
    if (!Array.isArray(raw['content'])) {
      throwInvalidInput('Invalid message content children');
    }
    node.content = raw['content'].map((child) =>
      validateNode(child, depth + 1, counter),
    );
  }

  return node;
}

/**
 * Validates a serialized ProseMirror-JSON rich email body and returns a
 * sanitized document containing only allowlisted node/mark types and
 * whitelisted attributes.
 *
 * @throws ConvexError (INVALID_INPUT) on any size, JSON, allowlist, or URL
 *   scheme violation.
 */
export function validateRichBodyJson(raw: string): RichBodyDoc {
  const byteLength = new TextEncoder().encode(raw).length;
  if (byteLength > MAX_RICH_EMAIL_BODY_JSON_BYTES) {
    throwInvalidInput(
      `Message content exceeds the maximum size of ${MAX_RICH_EMAIL_BODY_JSON_BYTES} bytes`,
      {byteLength},
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throwInvalidInput('Message content is not valid JSON');
  }

  if (!isRecord(parsed) || parsed['type'] !== 'doc') {
    throwInvalidInput('Message content must be a document');
  }

  const doc = validateNode(parsed, 0, {count: 0});
  return doc as RichBodyDoc;
}
