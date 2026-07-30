/**
 * Rich email body renderer — a pure string serializer over the VALIDATED
 * ProseMirror-JSON document.
 *
 * WHY hand-rolled and not TipTap's `generateHTML`: this module runs inside
 * Convex MUTATIONS (the default V8 isolate). `@tiptap/html`'s package exports
 * resolve the `browser` condition under Convex's esbuild bundler
 * (`platform: "browser"`), and that build throws at call time when `window` is
 * absent — while every Node-resolved test (vitest picks the `node` condition →
 * happy-dom server build) stays green. A DOM-free serializer is the only
 * variant that is safe in the isolate by construction.
 *
 * Correctness is pinned to TipTap anyway: `rich_text_render.oracle.test.ts`
 * renders the same documents through `@tiptap/html/server`'s `generateHTML`
 * (the editor's own serializer) and asserts structural equivalence, so this
 * serializer cannot drift from what the frontend editor produces.
 *
 * Security: input is the SANITIZED document from `validateRichBodyJson` — a
 * closed set of node/mark types with whitelisted, scheme-checked attributes.
 * All text and attribute values are additionally escaped here via
 * {@link escapeHtml}. Image nodes carry a `storageId` which is resolved to a
 * durable server-owned URL through `imageUrls`; a missing entry fails closed.
 *
 * The extracted plain text is the single source of truth for the email's text
 * part AND the stored `message` column; callers length-validate it.
 */
import {MAX_RICH_EMAIL_RENDERED_HTML_BYTES} from '@shared/constants';
import {
  validateRichBodyJson,
  type RichBodyDoc,
  type RichTextMark,
  type RichTextNode,
} from './rich_text_validator';
import {escapeHtml} from './escape_html';
import {throwInvalidInput} from '../errors';

/**
 * Inline styles per emitted tag — email-safe declarations mapped to the Braket
 * "Pulp" tokens (mirrors `baseStyles` in email/templates.ts). Explicit units,
 * `display: block` images, and normalized list margins so classic Outlook
 * renders predictably. Emitted directly as `style` attributes (email clients
 * ignore <style> sheets in fragments; `wrapEmail` provides the shell).
 */
const TAG_STYLES = {
  p: "margin: 0 0 16px 0; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #FAFAFA",
  h2: "margin: 24px 0 12px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 20px; line-height: 1.2; font-weight: 700; color: #FAFAFA",
  h3: "margin: 20px 0 10px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 17px; line-height: 1.25; font-weight: 700; color: #FAFAFA",
  ul: "margin: 0 0 16px 0; padding-left: 24px; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #FAFAFA",
  ol: "margin: 0 0 16px 0; padding-left: 24px; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6; color: #FAFAFA",
  li: 'margin: 0 0 6px 0',
  a: 'color: #F42A7E; text-decoration: underline',
  strong: 'font-weight: 700',
  em: 'font-style: italic',
  img: 'max-width: 100%; height: auto; display: block; border-radius: 4px; margin: 16px 0',
} as const;

function styleAttr(tag: keyof typeof TAG_STYLES): string {
  return ` style="${TAG_STYLES[tag]}"`;
}

/**
 * Wraps escaped inline HTML in its mark elements. The first mark in the array
 * becomes the outermost element, matching ProseMirror's serialization order.
 * (The TipTap editor merges adjacent same-marked text into a single text node,
 * so per-text-node wrapping matches real editor output; hand-forged JSON with
 * split runs renders slightly more verbose but visually identical HTML.)
 */
function wrapWithMarks(
  escapedInline: string,
  marks: readonly RichTextMark[] | undefined,
): string {
  if (marks === undefined || marks.length === 0) {
    return escapedInline;
  }
  let out = escapedInline;
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const mark = marks[i];
    switch (mark.type) {
      case 'bold':
        out = `<strong${styleAttr('strong')}>${out}</strong>`;
        break;
      case 'italic':
        out = `<em${styleAttr('em')}>${out}</em>`;
        break;
      case 'link': {
        // Validated: href exists and passed the URL-scheme allowlist. Emit the
        // same safety attributes the frontend editor's Link extension is
        // configured with (see rich-text-extensions.ts).
        const href = mark.attrs?.['href'];
        if (typeof href !== 'string') {
          throwInvalidInput('Link is missing its href');
        }
        out = `<a target="_blank" rel="noopener noreferrer nofollow" href="${escapeHtml(href)}"${styleAttr('a')}>${out}</a>`;
        break;
      }
      default:
        // Unreachable for validated docs; fail closed rather than drop marks.
        throwInvalidInput('Unsupported message content mark');
    }
  }
  return out;
}

function serializeChildren(
  node: RichTextNode,
  imageUrls: ReadonlyMap<string, string>,
): string {
  return (node.content ?? [])
    .map((child) => serializeNode(child, imageUrls))
    .join('');
}

function serializeNode(
  node: RichTextNode,
  imageUrls: ReadonlyMap<string, string>,
): string {
  switch (node.type) {
    case 'text': {
      if (typeof node.text !== 'string') {
        throwInvalidInput('Text node is missing its text');
      }
      return wrapWithMarks(escapeHtml(node.text), node.marks);
    }
    case 'hardBreak':
      return '<br>';
    case 'paragraph':
      return `<p${styleAttr('p')}>${serializeChildren(node, imageUrls)}</p>`;
    case 'heading': {
      // Validated: level ∈ RICH_TEXT_HEADING_LEVELS (2 | 3).
      const level = node.attrs?.['level'];
      if (level !== 2 && level !== 3) {
        throwInvalidInput('Heading has an unsupported level');
      }
      const tag = level === 2 ? 'h2' : 'h3';
      return `<${tag}${styleAttr(tag)}>${serializeChildren(node, imageUrls)}</${tag}>`;
    }
    case 'bulletList':
      return `<ul${styleAttr('ul')}>${serializeChildren(node, imageUrls)}</ul>`;
    case 'orderedList':
      return `<ol${styleAttr('ol')}>${serializeChildren(node, imageUrls)}</ol>`;
    case 'listItem':
      return `<li${styleAttr('li')}>${serializeChildren(node, imageUrls)}</li>`;
    case 'image': {
      // Validated: node carries {storageId, alt}. Resolve to the durable,
      // server-owned URL; a miss means an unverified image slipped past the
      // confirmedUploads gate — fail closed rather than emit a broken image.
      const storageId = node.attrs?.['storageId'];
      const src =
        typeof storageId === 'string' ? imageUrls.get(storageId) : undefined;
      if (src === undefined) {
        throwInvalidInput('Message contains an unresolved image reference');
      }
      const alt = node.attrs?.['alt'];
      return `<img${styleAttr('img')} src="${escapeHtml(src)}" alt="${escapeHtml(typeof alt === 'string' ? alt : '')}">`;
    }
    default:
      // Unreachable for validated docs (node types are allowlisted); fail
      // closed so an unhandled type can never be silently dropped.
      throwInvalidInput('Unsupported message content node');
  }
}

function extractInlineText(node: RichTextNode): string {
  if (node.type === 'text') {
    return node.text ?? '';
  }
  if (node.type === 'hardBreak') {
    return '\n';
  }
  if (node.type === 'image') {
    const alt = node.attrs?.['alt'];
    return typeof alt === 'string' ? alt : '';
  }
  return (node.content ?? []).map(extractInlineText).join('');
}

function extractBlockText(node: RichTextNode): string {
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return extractInlineText(node);
    case 'bulletList':
      return (node.content ?? [])
        .map((item) => `- ${extractBlockText(item).replace(/\n/g, ' ')}`)
        .join('\n');
    case 'orderedList':
      return (node.content ?? [])
        .map(
          (item, index) =>
            `${index + 1}. ${extractBlockText(item).replace(/\n/g, ' ')}`,
        )
        .join('\n');
    case 'listItem':
      return (node.content ?? []).map(extractBlockText).join('\n');
    case 'image':
      return extractInlineText(node);
    default:
      return (node.content ?? []).map(extractBlockText).join('\n');
  }
}

/** Derives a plain-text rendering from a validated rich body document. */
export function extractPlainText(doc: RichBodyDoc): string {
  return (doc.content ?? [])
    .map(extractBlockText)
    .filter((block) => block.length > 0)
    .join('\n\n')
    .trim();
}

/**
 * Renders an already-validated rich body document to an inline-styled HTML
 * fragment. Split from {@link renderRichBody} so callers can validate + extract
 * plain text cheaply (e.g. before a dedup or zero-recipient early-exit) and
 * defer the HTML render until a send is actually committed.
 *
 * @param imageUrls maps each image `storageId` to its durable server-owned URL
 *   (`/api/images/{storageId}`). Build it from the ids verified against
 *   `confirmedUploads` via `buildImageUrlMap`.
 */
export function renderValidatedRichBody(
  doc: RichBodyDoc,
  imageUrls: ReadonlyMap<string, string>,
): string {
  const html = (doc.content ?? [])
    .map((node) => serializeNode(node, imageUrls))
    .join('');
  // Amplification guard: the JSON byte cap does not bound the rendered size
  // (inline styles multiply small/empty nodes), and broadcasts fan the rendered
  // payload out to up to 500 recipients. Enforced here so no caller can forget
  // it; callers surface it as a plain validation failure before any
  // dedup/history/publication writes.
  const byteLength = new TextEncoder().encode(html).length;
  if (byteLength > MAX_RICH_EMAIL_RENDERED_HTML_BYTES) {
    throwInvalidInput('Message content is too large to send', {byteLength});
  }
  return html;
}

export function renderRichBody(
  bodyJson: string,
  imageUrls: ReadonlyMap<string, string>,
): {html: string; text: string} {
  const doc = validateRichBodyJson(bodyJson);
  return {
    html: renderValidatedRichBody(doc, imageUrls),
    text: extractPlainText(doc),
  };
}
