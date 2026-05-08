import { Component, ChangeDetectionStrategy, input } from '@angular/core';

/**
 * A three-column layout component with waterfall texture background.
 *
 * - Side columns display the waterfall texture background.
 * - Center column has solid bg-background for content readability.
 * - The layout is responsive: stacks on mobile, three columns on md+.
 *
 * Usage:
 * ```html
 * <app-content-layout>
 *   Your main content goes here
 * </app-content-layout>
 * ```
 */
@Component({
  selector: 'app-content-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  template: `
    <main
      id="main-content"
      class="grow grid grid-cols-1 md:grid-cols-[1fr_minmax(auto,64rem)_1fr] relative overflow-hidden bg-waterfall"
    >
      <!-- Left Column: Empty space for textured margin -->
      <div class="hidden md:block border-r border-border"></div>

      <!-- Center Column: Main Content -->
      <div
        class="flex flex-col px-6 md:px-12 py-2 md:py-8 relative z-10 min-w-0 overflow-hidden"
        [class.bg-background]="!glass()"
        [class.glass-panel]="glass()"
      >
        <ng-content />
      </div>

      <!-- Right Column: Empty space for textured margin -->
      <div class="hidden md:block border-l border-border"></div>
    </main>
  `,
})
export class ContentLayoutComponent {
  readonly glass = input(true);
}
