import {describe, expect, it} from 'vitest';
import {ConvexError} from 'convex/values';
import {
  RICH_TEXT_MARK_TYPES,
  RICH_TEXT_NODE_TYPES,
} from '@shared/email/rich-text-schema';
import {renderRichBody, renderValidatedRichBody} from './rich_text_render';
import type {RichBodyDoc} from './rich_text_validator';

const docWith = (content: unknown): string =>
  JSON.stringify({type: 'doc', content});

const DURABLE_IMG = 'https://acme.convex.site/api/images/sid1';
const imageMap = new Map<string, string>([['sid1', DURABLE_IMG]]);

describe('serializer — allowlist coverage (drift guard)', () => {
  it('renders every allowlisted node and mark type', () => {
    // One document exercising every node/mark type in the shared allowlist.
    // If a type is ever added to the allowlist without serializer support, the
    // serializer's fail-closed default branch makes this test throw.
    const {html} = renderRichBody(
      docWith([
        {
          type: 'heading',
          attrs: {level: 2},
          content: [{type: 'text', text: 'h'}],
        },
        {
          type: 'heading',
          attrs: {level: 3},
          content: [{type: 'text', text: 'h'}],
        },
        {
          type: 'paragraph',
          content: [
            {type: 'text', text: 'b', marks: [{type: 'bold'}]},
            {type: 'text', text: 'i', marks: [{type: 'italic'}]},
            {
              type: 'text',
              text: 'l',
              marks: [{type: 'link', attrs: {href: 'https://x.com'}}],
            },
            {type: 'hardBreak'},
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {type: 'paragraph', content: [{type: 'text', text: 'u'}]},
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {type: 'paragraph', content: [{type: 'text', text: 'o'}]},
              ],
            },
          ],
        },
        {type: 'image', attrs: {storageId: 'sid1', alt: 'img'}},
      ]),
      imageMap,
    );
    // Every allowlisted node type (bar the structural doc/text/hardBreak/
    // listItem handled implicitly above) has a visible element in the output.
    for (const tag of [
      '<h2',
      '<h3',
      '<p',
      '<br>',
      '<ul',
      '<ol',
      '<li',
      '<img',
    ]) {
      expect(html).toContain(tag);
    }
    for (const tag of ['<strong', '<em', '<a ']) {
      expect(html).toContain(tag);
    }
    // Guard against silent allowlist growth: this corpus must be regenerated
    // if the shared allowlist gains new node/mark types.
    expect([...RICH_TEXT_NODE_TYPES].sort()).toEqual(
      [
        'doc',
        'paragraph',
        'text',
        'heading',
        'bulletList',
        'orderedList',
        'listItem',
        'hardBreak',
        'image',
      ].sort(),
    );
    expect([...RICH_TEXT_MARK_TYPES].sort()).toEqual(
      ['bold', 'italic', 'link'].sort(),
    );
  });

  it('fails closed on a node type outside the allowlist (defense-in-depth)', () => {
    // renderValidatedRichBody trusts its input is validated; if an unvalidated
    // doc ever reaches it, unknown types must throw, never silently drop.
    const forged = {
      type: 'doc',
      content: [{type: 'iframe', attrs: {}}],
    } as unknown as RichBodyDoc;
    expect(() => renderValidatedRichBody(forged, imageMap)).toThrow(
      ConvexError,
    );
  });

  it('rejects a body whose rendered HTML exceeds the amplification cap', () => {
    // ~5KB of JSON (250 near-empty paragraphs) renders to ~49KB of inline-
    // styled HTML — the amplification the rendered-size cap exists to stop.
    // The single text node keeps the extracted plaintext non-empty so this
    // failure is specifically the rendered-size gate, not the empty-message
    // check in the handlers.
    const paragraphs = [
      {type: 'paragraph', content: [{type: 'text', text: 'x'}]},
      ...Array.from({length: 250}, () => ({type: 'paragraph'})),
    ];
    expect(() => renderRichBody(docWith(paragraphs), imageMap)).toThrow(
      ConvexError,
    );
  });

  it('escapes text, alt, and href against markup injection', () => {
    const {html} = renderRichBody(
      docWith([
        {
          type: 'paragraph',
          content: [{type: 'text', text: '<script>alert(1)</script>'}],
        },
        {
          type: 'image',
          attrs: {storageId: 'sid1', alt: '"><script>x</script>'},
        },
      ]),
      imageMap,
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('renderRichBody — HTML rendering', () => {
  it('renders headings, marks, lists, links, and images with inline styles', () => {
    const {html} = renderRichBody(
      docWith([
        {
          type: 'heading',
          attrs: {level: 2},
          content: [{type: 'text', text: 'Heading Two'}],
        },
        {
          type: 'paragraph',
          content: [
            {type: 'text', text: 'bold', marks: [{type: 'bold'}]},
            {type: 'text', text: 'italic', marks: [{type: 'italic'}]},
            {
              type: 'text',
              text: 'a link',
              marks: [{type: 'link', attrs: {href: 'https://example.com'}}],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {type: 'paragraph', content: [{type: 'text', text: 'first'}]},
              ],
            },
          ],
        },
        {
          type: 'image',
          attrs: {storageId: 'sid1', alt: 'poster'},
        },
      ]),
      imageMap,
    );

    expect(html).toContain('<h2');
    expect(html).toContain('Heading Two');
    expect(html).toContain('<strong');
    expect(html).toContain('<em');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<ul');
    expect(html).toContain('<li');
    // The image resolves to the DURABLE server-owned route, never a client src.
    expect(html).toContain(`src="${DURABLE_IMG}"`);
    expect(html).toContain('alt="poster"');
    // The persisted storageId must NOT leak into the rendered <img>.
    expect(html).not.toContain('storageId');
    expect(html).not.toContain('data-storage-id');
    // Inline-styled from the serializer's TAG_STYLES map.
    expect(html).toContain('#FAFAFA');
    expect(html).toContain('#F42A7E');
    expect(html).toContain('style=');
  });

  it('never emits a client-supplied src even if one is smuggled onto the node', () => {
    // The validator drops a client `src`, but assert defensively that render
    // uses only the durable map value keyed by storageId.
    const {html} = renderRichBody(
      docWith([
        {
          type: 'image',
          attrs: {storageId: 'sid1', alt: 'x'},
        },
      ]),
      imageMap,
    );
    expect(html).toContain(`src="${DURABLE_IMG}"`);
    expect(html).not.toContain('attacker');
  });

  it('throws when an image references a storageId absent from the url map', () => {
    let thrown: unknown;
    try {
      renderRichBody(
        docWith([{type: 'image', attrs: {storageId: 'unknown', alt: 'x'}}]),
        imageMap,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConvexError);
  });

  it('does not emit a full HTML document (fragment only, wrapEmail provides shell)', () => {
    const {html} = renderRichBody(
      docWith([{type: 'paragraph', content: [{type: 'text', text: 'hi'}]}]),
      imageMap,
    );
    expect(html).not.toContain('<!DOCTYPE');
    expect(html).not.toContain('<html');
    expect(html).not.toContain('<head');
  });
});

describe('renderRichBody — plain-text extraction', () => {
  it('extracts block text with list markers and image alt', () => {
    const {text} = renderRichBody(
      docWith([
        {
          type: 'heading',
          attrs: {level: 2},
          content: [{type: 'text', text: 'Title'}],
        },
        {type: 'paragraph', content: [{type: 'text', text: 'Body line.'}]},
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {type: 'paragraph', content: [{type: 'text', text: 'one'}]},
              ],
            },
            {
              type: 'listItem',
              content: [
                {type: 'paragraph', content: [{type: 'text', text: 'two'}]},
              ],
            },
          ],
        },
        {
          type: 'image',
          attrs: {storageId: 'sid1', alt: 'a poster'},
        },
      ]),
      imageMap,
    );

    expect(text).toContain('Title');
    expect(text).toContain('Body line.');
    expect(text).toContain('- one');
    expect(text).toContain('- two');
    expect(text).toContain('a poster');
  });

  it('numbers ordered-list items', () => {
    const {text} = renderRichBody(
      docWith([
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {type: 'paragraph', content: [{type: 'text', text: 'alpha'}]},
              ],
            },
            {
              type: 'listItem',
              content: [
                {type: 'paragraph', content: [{type: 'text', text: 'beta'}]},
              ],
            },
          ],
        },
      ]),
      imageMap,
    );
    expect(text).toContain('1. alpha');
    expect(text).toContain('2. beta');
  });

  it('returns empty html and text for an empty document', () => {
    const {html, text} = renderRichBody(
      JSON.stringify({type: 'doc', content: []}),
      new Map<string, string>(),
    );
    expect(text).toBe('');
    expect(html).toBe('');
  });
});
