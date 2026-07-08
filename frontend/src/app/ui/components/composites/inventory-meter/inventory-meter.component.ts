import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  ViewEncapsulation,
} from '@angular/core';

/**
 * Inventory meter — dual-segment horizontal bar showing sold vs. held vs. free
 * capacity against a total.
 *
 * Why three segments instead of one: Convex inventory has both `soldCount`
 * (permanent, post-checkout) and `heldCount` (transient, open-order reservations).
 * Collapsing them into a single progress value hides an important distinction for
 * organizers — a "sold out" event may have capacity that frees up as holds expire.
 *
 * Visual language:
 * - SOLD segment: solid fill, primary (plum) — permanent state
 * - HELD segment: diagonal stripe pattern, violet — transient/warning language
 *   (like barricade tape — "count this later")
 * - FREE segment: muted base with subtle tick marks
 *
 * The stripe pattern makes the held segment legible without relying on color alone.
 */
@Component({
  selector: 'bra-inventory-meter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'block w-full',
  },
  template: `
    <div class="space-y-3">
      <!-- Top row: main stat + percentage pill -->
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p
            class="mb-1 font-mono text-2xs tracking-widest text-muted-foreground uppercase"
          >
            {{ label() }}
          </p>
          <p
            class="font-display text-3xl leading-none text-foreground tabular-nums"
            [attr.data-testid]="testid() + '-main'"
          >
            {{ soldCount() }}
            <span class="text-2xl text-muted-foreground/60">/</span>
            {{ totalTickets() }}
          </p>
        </div>
        <div
          class="shrink-0 rounded-full border border-primary/30 bg-primary/30 px-3 py-1 font-mono text-sm text-foreground tabular-nums"
          [attr.data-testid]="testid() + '-percent'"
        >
          {{ soldPercentage() }}%
        </div>
      </div>

      <!-- Meter.
           aria-valuenow reports occupied capacity (sold + held) so AT that
           interrogates the numeric value directly matches what the bar
           visually fills to. aria-valuetext takes precedence for SR
           announcement and carries the full sold/held/remaining breakdown. -->
      <div
        class="inventory-meter-track relative h-2.5 w-full overflow-hidden border border-border bg-muted/60"
        role="progressbar"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="totalTickets()"
        [attr.aria-valuenow]="occupiedCount()"
        [attr.aria-valuetext]="ariaValueText()"
      >
        <!-- Sold segment: solid primary -->
        @if (soldPercentage() > 0) {
          <div
            class="absolute inset-y-0 left-0 bg-primary transition-[width] duration-300 ease-out"
            [style.width.%]="soldPercentage()"
            [attr.data-testid]="testid() + '-sold-segment'"
          ></div>
        }
        <!-- Held segment: diagonal stripes, violet — transient/warning language -->
        @if (heldPercentage() > 0) {
          <div
            class="inventory-meter-held absolute inset-y-0 transition-[left,width] duration-300 ease-out"
            [style.left.%]="soldPercentage()"
            [style.width.%]="heldPercentage()"
            [attr.data-testid]="testid() + '-held-segment'"
          ></div>
        }
      </div>

      <!-- Below-meter status line: context-dependent copy -->
      <p
        class="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs tracking-widest uppercase"
        [attr.data-testid]="testid() + '-status'"
      >
        @if (remainingCount() > 0) {
          <span class="text-muted-foreground">
            <span class="text-foreground tabular-nums">{{
              remainingCount()
            }}</span>
            remaining
          </span>
        } @else {
          <span class="text-destructive-text">sold out</span>
        }
        @if (heldCount() > 0) {
          <span class="text-muted-foreground/60 select-none" aria-hidden="true"
            >·</span
          >
          <span class="text-[color:var(--chart-4,theme(colors.violet.400))]">
            <span class="tabular-nums">{{ heldCount() }}</span>
            in checkout
          </span>
        }
      </p>
    </div>
  `,
  styles: `
    .inventory-meter-held {
      /* Violet with diagonal stripes — held = transient, "count this later".
         Uses chart-4 (violet) if the theme defines it, falls back to a hard
         violet so tests and consumers without Pulp tokens still render a
         visually distinct segment. */
      background-color: var(--chart-4, #a78bfa);
      background-image: repeating-linear-gradient(
        -45deg,
        transparent 0,
        transparent 3px,
        rgba(0, 0, 0, 0.25) 3px,
        rgba(0, 0, 0, 0.25) 5px
      );
    }

    .inventory-meter-track::after {
      /* Subtle tick marks every 10% on the unfilled portion — editorial/VU-meter
         texture, not decorative clutter. Only visible where segments don't paint. */
      content: '';
      position: absolute;
      inset: 0;
      background-image: repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(10% - 1px),
        rgba(0, 0, 0, 0.08) calc(10% - 1px),
        rgba(0, 0, 0, 0.08) 10%
      );
      pointer-events: none;
    }

    :host-context(.dark) .inventory-meter-track::after {
      background-image: repeating-linear-gradient(
        to right,
        transparent 0,
        transparent calc(10% - 1px),
        rgba(255, 255, 255, 0.06) calc(10% - 1px),
        rgba(255, 255, 255, 0.06) 10%
      );
    }

    @media (prefers-reduced-motion: reduce) {
      .inventory-meter-track > div {
        transition: none !important;
      }
    }
  `,
})
export class BraInventoryMeterComponent {
  readonly soldCount = input.required<number>();
  readonly heldCount = input<number>(0);
  readonly totalTickets = input.required<number>();
  /** Label above the main stat. Mono signature auto-applied. */
  readonly label = input<string>('Tickets Sold');
  /** Prefix for data-testid attributes — makes it addressable in harnesses. */
  readonly testid = input<string>('inventory-meter');

  readonly remainingCount = computed(() =>
    Math.max(0, this.totalTickets() - this.soldCount() - this.heldCount()),
  );

  /**
   * Occupied capacity = sold + held, clamped to totalTickets. Used for
   * `aria-valuenow` so numeric interrogation matches the bar's visual fill.
   */
  readonly occupiedCount = computed(() =>
    Math.min(this.totalTickets(), this.soldCount() + this.heldCount()),
  );

  readonly soldPercentage = computed(() => {
    if (this.totalTickets() === 0) return 0;
    return Math.min(
      100,
      Math.round((this.soldCount() / this.totalTickets()) * 100),
    );
  });

  readonly heldPercentage = computed(() => {
    if (this.totalTickets() === 0) return 0;
    // Clamp so sold + held never exceeds 100%.
    const raw = Math.round((this.heldCount() / this.totalTickets()) * 100);
    return Math.max(0, Math.min(100 - this.soldPercentage(), raw));
  });

  readonly ariaValueText = computed(() => {
    const sold = this.soldCount();
    const held = this.heldCount();
    const remaining = this.remainingCount();
    const total = this.totalTickets();
    const parts = [`${sold} of ${total} sold`];
    if (held > 0) parts.push(`${held} in checkout`);
    parts.push(remaining === 0 ? 'sold out' : `${remaining} remaining`);
    return parts.join(', ');
  });
}
