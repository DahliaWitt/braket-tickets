import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  input,
  ViewEncapsulation,
} from '@angular/core';

@Component({
  selector: 'app-empty-state',
  imports: [],
  template: `
    <div
      class="border border-dashed border-border rounded-xl p-12 text-center flex flex-col items-center justify-center gap-2"
      [attr.role]="isStatus() ? 'status' : null"
      [attr.aria-live]="isStatus() ? 'polite' : null"
      [attr.aria-label]="ariaLabel() || null"
    >
      <ng-content select="[icon]" />
      @if (title()) {
        <p data-testid="empty-state-title" class="text-muted-foreground font-mono uppercase tracking-widest">{{ title() }}</p>
      }
      @if (description()) {
        <p data-testid="empty-state-description" class="text-sm text-muted-foreground/80 max-w-sm">{{ description() }}</p>
      }
      <ng-content />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
})
export class EmptyStateComponent {
  readonly title = input<string>('');
  readonly description = input<string>('');
  /** When true, adds role="status" and aria-live="polite" for screen reader announcements */
  readonly isStatus = input(false, { transform: booleanAttribute });
  /** Optional aria-label override for the container */
  readonly ariaLabel = input<string>('');
}
