/**
 * Escapes HTML special characters to prevent XSS in email HTML.
 *
 * Single source of truth for email-side HTML escaping — used by the branded
 * templates (`email/templates.ts`) and the rich-body serializer
 * (`lib/email/rich_text_render.ts`). Escapes quotes as well, so the result is
 * safe in both text content and double/single-quoted attribute values.
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
