import {type Extensions} from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Heading from '@tiptap/extension-heading';
import {BulletList, ListItem, OrderedList} from '@tiptap/extension-list';
import HardBreak from '@tiptap/extension-hard-break';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import {
  RICH_TEXT_HEADING_LEVELS,
  RICH_TEXT_LINK_URL_SCHEMES,
} from '@shared/email/rich-text-schema';

/**
 * Builds the TipTap extension set for the rich email-body editor.
 *
 * This is the FRONTEND half of the "identical schema on both sides" contract:
 * the node/mark names produced here MUST match the shared allowlist in
 * `@shared/email/rich-text-schema`, which the backend validator + renderer also
 * consume. `rich-text-extensions.spec.ts` enforces that with a drift test.
 *
 * Security posture mirrors the backend:
 *  - links are restricted to the allowlisted URL schemes and never auto-linked
 *    or opened on click inside the editor,
 *  - images reject base64 data URIs (`allowBase64: false`), and
 *  - images persist a `storageId` (a confirmed Convex upload), not a
 *    client-authored `src`. `src` is a display-only preview attribute; the
 *    backend renderer re-derives a durable server-owned `src` from `storageId`
 *    at send time, so the emailed image can never point at an arbitrary host.
 */

/**
 * Image node extended with a persisted `storageId` attribute. The node keeps the
 * standard `src`/`alt` attributes (serialized to `data-*` on the DOM), but
 * `storageId` is the load-bearing reference: it is what survives into `bodyJson`
 * and what the backend verifies against `confirmedUploads`. `src` is only a
 * preview shown in the composer.
 */
const StorageImage = Image.extend({
  addAttributes() {
    // Preserve the base extension's attributes (src, alt, title, …). `parent`
    // is loosely typed by TipTap, so narrow it before spreading.
    const parentAttributes: Record<string, unknown> =
      (this.parent?.() as Record<string, unknown> | undefined) ?? {};
    return {
      ...parentAttributes,
      storageId: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-storage-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const storageId = attributes['storageId'];
          return typeof storageId === 'string' && storageId.length > 0
            ? {'data-storage-id': storageId}
            : {};
        },
      },
    };
  },
});

export function buildRichTextEmailExtensions(): Extensions {
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
    StorageImage.configure({inline: false, allowBase64: false}),
  ];
}
