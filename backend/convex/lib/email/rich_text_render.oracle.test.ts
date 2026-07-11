/**
 * Oracle equivalence test: the pure-JS email serializer must produce the same
 * structural HTML as TipTap's own `generateHTML` — the exact serializer that
 * powers the frontend editor.
 *
 * WHY this exists: `@tiptap/html` cannot run in the Convex mutation isolate
 * (its browser build needs `window`; its node build needs happy-dom), so the
 * runtime uses the hand-rolled serializer in `rich_text_render.ts`. This test
 * pins that serializer to TipTap's reference output so it can never drift from
 * what the editor produces. It runs ONLY under vitest (Node resolution picks
 * `@tiptap/html`'s server build); none of these imports ship to the isolate.
 *
 * Comparison strips our inline `style` attributes (TipTap emits none) and uses
 * editor-realistic documents: TipTap's `getJSON()` merges adjacent same-marked
 * text into single text nodes and never emits quote characters differently, so
 * exact string equality holds for this corpus.
 */
import {describe, expect, it} from 'vitest';
import {generateHTML} from '@tiptap/html/server';
import Bold from '@tiptap/extension-bold';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import Image from '@tiptap/extension-image';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import {BulletList, ListItem, OrderedList} from '@tiptap/extension-list';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import type {Extensions, JSONContent} from '@tiptap/core';
import {
  RICH_TEXT_HEADING_LEVELS,
  RICH_TEXT_LINK_URL_SCHEMES,
} from '@shared/email/rich-text-schema';
import {renderValidatedRichBody} from './rich_text_render';
import type {RichBodyDoc, RichTextNode} from './rich_text_validator';

/** Mirrors the frontend editor's extension config (rich-text-extensions.ts). */
function buildOracleExtensions(): Extensions {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Heading.configure({levels: [...RICH_TEXT_HEADING_LEVELS]}),
    BulletList,
    OrderedList,
    ListItem,
    HardBreak,
    Link.configure({
      openOnClick: false,
      autolink: false,
      protocols: [...RICH_TEXT_LINK_URL_SCHEMES],
      HTMLAttributes: {rel: 'noopener noreferrer nofollow', target: '_blank'},
    }),
    Image.configure({inline: false, allowBase64: false}),
  ];
}

const DURABLE_IMG = 'https://acme.convex.site/api/images/sid1';
const imageMap = new Map<string, string>([['sid1', DURABLE_IMG]]);

/** Strips our serializer's inline style attributes for structural comparison. */
function stripStyles(html: string): string {
  return html.replace(/ style="[^"]*"/g, '');
}

/**
 * Rewrites image nodes from {storageId, alt} (our validated form) to
 * {src, alt} (TipTap's schema) so the oracle can render the same document.
 */
function resolveForOracle(node: RichTextNode): RichTextNode {
  if (node.type === 'image') {
    const storageId = node.attrs?.['storageId'];
    const src =
      typeof storageId === 'string' ? imageMap.get(storageId) : undefined;
    return {type: 'image', attrs: {src, alt: node.attrs?.['alt'] ?? ''}};
  }
  if (node.content === undefined) return node;
  return {...node, content: node.content.map(resolveForOracle)};
}

function assertMatchesOracle(doc: RichBodyDoc): void {
  const ours = stripStyles(renderValidatedRichBody(doc, imageMap));
  const oracle = generateHTML(
    resolveForOracle(doc) as unknown as JSONContent,
    buildOracleExtensions(),
  );
  expect(ours).toBe(oracle);
}

const doc = (content: RichTextNode[]): RichBodyDoc => ({type: 'doc', content});

describe('serializer ⇄ TipTap generateHTML equivalence', () => {
  it('headings', () => {
    assertMatchesOracle(
      doc([
        {
          type: 'heading',
          attrs: {level: 2},
          content: [{type: 'text', text: 'Title'}],
        },
        {
          type: 'heading',
          attrs: {level: 3},
          content: [{type: 'text', text: 'Subtitle'}],
        },
      ]),
    );
  });

  it('paragraphs with marks and hard breaks', () => {
    assertMatchesOracle(
      doc([
        {
          type: 'paragraph',
          content: [
            {type: 'text', text: 'plain '},
            {type: 'text', text: 'bold', marks: [{type: 'bold'}]},
            {type: 'text', text: ' then '},
            {type: 'text', text: 'italic', marks: [{type: 'italic'}]},
            {type: 'hardBreak'},
            {
              type: 'text',
              text: 'bold italic',
              marks: [{type: 'bold'}, {type: 'italic'}],
            },
          ],
        },
      ]),
    );
  });

  it('links, including marked link text', () => {
    assertMatchesOracle(
      doc([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'a link',
              marks: [
                {type: 'link', attrs: {href: 'https://example.com/x?a=1'}},
              ],
            },
            {
              type: 'text',
              text: 'bold link',
              marks: [
                {type: 'link', attrs: {href: 'mailto:hi@example.com'}},
                {type: 'bold'},
              ],
            },
          ],
        },
      ]),
    );
  });

  it('nested lists', () => {
    assertMatchesOracle(
      doc([
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {type: 'paragraph', content: [{type: 'text', text: 'one'}]},
                {
                  type: 'orderedList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{type: 'text', text: 'nested'}],
                        },
                      ],
                    },
                  ],
                },
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
      ]),
    );
  });

  it('images between blocks', () => {
    assertMatchesOracle(
      doc([
        {type: 'paragraph', content: [{type: 'text', text: 'before'}]},
        {type: 'image', attrs: {storageId: 'sid1', alt: 'poster'}},
        {type: 'paragraph', content: [{type: 'text', text: 'after'}]},
      ]),
    );
  });

  it('kitchen sink document', () => {
    assertMatchesOracle(
      doc([
        {
          type: 'heading',
          attrs: {level: 2},
          content: [{type: 'text', text: 'Lineup'}],
        },
        {
          type: 'paragraph',
          content: [
            {type: 'text', text: 'Doors at 10 '},
            {type: 'text', text: 'sharp', marks: [{type: 'bold'}]},
            {type: 'hardBreak'},
            {
              type: 'text',
              text: 'tickets',
              marks: [{type: 'link', attrs: {href: 'https://braket.io/e/1'}}],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {type: 'paragraph', content: [{type: 'text', text: 'act one'}]},
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {type: 'text', text: 'act two ', marks: [{type: 'italic'}]},
                    {type: 'text', text: 'late', marks: [{type: 'bold'}]},
                  ],
                },
              ],
            },
          ],
        },
        {type: 'image', attrs: {storageId: 'sid1', alt: 'flyer'}},
        {type: 'paragraph', content: []},
      ]),
    );
  });

  it('empty document', () => {
    // TipTap's generateHTML on an empty doc and ours both emit nothing.
    const ours = stripStyles(renderValidatedRichBody(doc([]), imageMap));
    expect(ours).toBe('');
  });
});
