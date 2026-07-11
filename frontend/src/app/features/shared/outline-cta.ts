/**
 * Shared outline-mono CTA treatment. One deliberate look: primary border,
 * Space Mono micro label (uppercase, widest tracking), foreground text on a
 * flat transparent base that fills with the primary token on hover. No glow —
 * the sanctioned emphasis effect is the zGlow button variant, and this
 * treatment intentionally stays flat.
 *
 * Surfaces that consume it:
 * - the public pages (landing, about, not-found) via `OUTLINE_MONO_CTA_CLASS`
 *   (the `xl` / hover preset plus public button chrome), and
 * - the signed-in dashboard's inline CTAs (community apply chips, the vetting
 *   resubmit link, the get-tickets button) via direct `outlineMonoCta({...})`
 *   calls, each with its own size and hover trigger.
 *
 * `outlineMonoCta` returns only the shared treatment tokens. Compose
 * element-specific layout (widths, flex, margins) into the same `[class]`
 * binding — e.g. `[class]="'inline-block ' + ctaClass"` — matching the repo's
 * class-binding convention.
 */

/** Which hover fills the CTA: the element itself, or an ancestor marked `group`. */
export type OutlineMonoCtaTrigger = 'hover' | 'group';

/** Border-width + padding preset, smallest (`xs`) to largest (`xl`). */
export type OutlineMonoCtaSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const OUTLINE_MONO_CTA_SIZE: Record<OutlineMonoCtaSize, string> = {
  xs: 'border px-3 py-1',
  sm: 'border px-4 py-1.5',
  md: 'border px-4 py-2',
  lg: 'border-2 px-6 py-2',
  xl: 'border-2 px-8 py-3',
};

/**
 * Build the outline-mono CTA treatment class string.
 *
 * @param trigger `'hover'` (default) fills on the element's own hover;
 *   `'group'` fills when an ancestor marked `group` is hovered.
 * @param size border-width + padding preset (default `'xl'`).
 */
export function outlineMonoCta({
  trigger = 'hover',
  size = 'xl',
}: {
  trigger?: OutlineMonoCtaTrigger;
  size?: OutlineMonoCtaSize;
} = {}): string {
  const fill =
    trigger === 'group'
      ? 'group-hover:bg-primary group-hover:text-primary-foreground'
      : 'hover:bg-primary hover:text-primary-foreground';
  return `${OUTLINE_MONO_CTA_SIZE[size]} border-primary font-mono text-2xs tracking-widest text-foreground uppercase transition-colors ${fill}`;
}

/**
 * Backward-compatible public-page preset: the `xl` / hover treatment plus the
 * public button chrome (focus ring, inline-block centering, transparent base,
 * pointer cursor). Consumed by landing, about, and not-found via `[class]`.
 */
export const OUTLINE_MONO_CTA_CLASS = `focus-ring inline-block cursor-pointer bg-transparent text-center ${outlineMonoCta(
  {trigger: 'hover', size: 'xl'},
)}`;
