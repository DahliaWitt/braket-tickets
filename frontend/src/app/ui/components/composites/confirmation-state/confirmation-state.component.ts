import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
} from '@angular/core';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import type {ZardIcon} from '@ui/components/primitives/icon/icons';

/**
 * Variant-to-style mapping for the confirmation state display.
 *
 * Each variant controls the icon circle background and icon/spinner color.
 * "warning" covers the accent-colored "pending" states used in email-change flows.
 */
const VARIANT_STYLES = {
  loading: {bg: 'bg-primary/20', color: 'text-primary'},
  success: {bg: 'bg-secondary/10', color: 'text-secondary'},
  error: {bg: 'bg-destructive/20', color: 'text-destructive-text'},
  warning: {bg: 'bg-accent/20', color: 'text-accent'},
  info: {bg: 'bg-primary/20', color: 'text-primary'},
} as const;

type ConfirmationVariant = keyof typeof VARIANT_STYLES;

@Component({
  selector: 'app-confirmation-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardIconComponent],
  template: `
    <div class="space-y-4">
      <div [attr.id]="iconId() || null" [class]="iconContainerClass()">
        @if (loading()) {
          <z-icon zType="loader-circle" [class]="loadingIconClass()" />
        } @else {
          <z-icon [zType]="icon()" [class]="iconClass()" />
        }
      </div>
      <h2 class="font-display text-xl tracking-wide text-foreground uppercase">
        {{ title() }}
      </h2>
      @if (description()) {
        <p [attr.id]="descriptionId() || null" [class]="descriptionTextClass()">
          {{ description() }}
        </p>
      }
      <ng-content />
    </div>
  `,
})
export class ConfirmationStateComponent {
  /** Lucide icon name displayed in the circle (ignored when loading=true). */
  readonly icon = input.required<ZardIcon>();

  /** Heading text below the icon. */
  readonly title = input.required<string>();

  /** Optional description paragraph below the heading. */
  readonly description = input<string>();

  /** Visual variant controlling colors. */
  readonly variant = input<ConfirmationVariant>('info');

  /** When true, shows a spinning loader instead of the icon and pulses the circle. */
  readonly loading = input(false);

  /** Optional DOM id applied to the icon circle (preserves test selectors). */
  readonly iconId = input<string>();

  /** Optional DOM id applied to the description paragraph (preserves test selectors). */
  readonly descriptionId = input<string>();

  readonly iconBgClass = computed(() => {
    const base = VARIANT_STYLES[this.variant()].bg;
    return this.loading() ? `${base} animate-pulse` : base;
  });

  readonly iconColorClass = computed(
    () => VARIANT_STYLES[this.variant()].color,
  );

  readonly iconContainerClass = computed(
    () =>
      `w-16 h-16 mx-auto rounded-full flex items-center justify-center ${this.iconBgClass()}`,
  );

  readonly loadingIconClass = computed(
    () => `w-8 h-8 animate-spin ${this.iconColorClass()}`,
  );

  readonly iconClass = computed(() => `w-8 h-8 ${this.iconColorClass()}`);

  readonly descriptionClass = computed(() =>
    this.variant() === 'error'
      ? 'text-destructive-text'
      : 'text-muted-foreground',
  );

  readonly descriptionTextClass = computed(
    () => `text-sm font-sans ${this.descriptionClass()}`,
  );
}
