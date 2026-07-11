/**
 * Shared outline-mono CTA treatment for the public pages (landing, about,
 * not-found). One deliberate look: 2px primary border, Space Mono micro
 * label, fill-on-hover. No glow — the sanctioned emphasis effect is the
 * zGlow button variant, and this treatment intentionally stays flat.
 *
 * Apply via `[class]` on a native `<button>` or `<a>`; extra layout classes
 * (widths, margins) go on the static `class` attribute and are merged by
 * Angular.
 */
export const OUTLINE_MONO_CTA_CLASS =
  'focus-ring inline-block cursor-pointer border-2 border-primary bg-transparent px-8 py-3 text-center font-mono text-2xs tracking-widest text-foreground uppercase transition-colors hover:bg-primary hover:text-primary-foreground';
