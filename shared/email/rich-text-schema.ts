/**
 * Rich email body schema allowlist — single source of truth.
 *
 * PLAIN DATA ONLY. This module MUST NOT import `@tiptap/*` (or any runtime
 * dependency). It declares the allowlisted ProseMirror node types, mark types,
 * heading levels, and URL schemes that a rich email body (`bodyJson`) may
 * contain. It is consumed by:
 *
 *  - the backend security validator (`backend/convex/lib/email/rich_text_validator.ts`),
 *  - the backend render factory (`backend/convex/lib/email/rich_text_render.ts`), and
 *  - the frontend editor extension factory
 *    (`frontend/src/app/features/admin/components/rich-text-editor/rich-text-extensions.ts`).
 *
 * `@tiptap` is not hoisted to the workspace root and `shared/` declares no
 * dependencies, so a shared file importing `@tiptap/*` would fail bundler
 * resolution in both the Convex esbuild bundle and the Angular build. Each side
 * therefore maps these names to concrete `@tiptap` extension objects locally,
 * and each side ships a drift test asserting its factory's node/mark name set
 * equals these allowlists.
 */

/** Allowed ProseMirror node type names. */
export const RICH_TEXT_NODE_TYPES = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'hardBreak',
  'image',
] as const;
export type RichTextNodeType = (typeof RICH_TEXT_NODE_TYPES)[number];

/** Allowed ProseMirror mark type names. */
export const RICH_TEXT_MARK_TYPES = ['bold', 'italic', 'link'] as const;
export type RichTextMarkType = (typeof RICH_TEXT_MARK_TYPES)[number];

/** Allowed heading levels (h2, h3). */
export const RICH_TEXT_HEADING_LEVELS = [2, 3] as const;
export type RichTextHeadingLevel = (typeof RICH_TEXT_HEADING_LEVELS)[number];

/** URL schemes permitted on link-mark `href`. */
export const RICH_TEXT_LINK_URL_SCHEMES = ['http', 'https', 'mailto'] as const;

/**
 * URL schemes permitted on an inline-image PREVIEW url.
 *
 * Image nodes no longer carry a client-supplied `src`: the security spine
 * requires a `storageId` referencing a confirmed upload, and the renderer emits
 * a durable server-owned `src` (`/api/images/{storageId}`). This allowlist is
 * therefore only a defensive UX guard on the composer's short-lived signed
 * preview url — never an authorization boundary.
 */
export const RICH_TEXT_IMAGE_URL_SCHEMES = ['http', 'https'] as const;

/** Set form for O(1) membership checks. */
export const RICH_TEXT_NODE_TYPE_SET: ReadonlySet<string> = new Set(
  RICH_TEXT_NODE_TYPES,
);
export const RICH_TEXT_MARK_TYPE_SET: ReadonlySet<string> = new Set(
  RICH_TEXT_MARK_TYPES,
);
export const RICH_TEXT_HEADING_LEVEL_SET: ReadonlySet<number> = new Set(
  RICH_TEXT_HEADING_LEVELS,
);
