import {
  Component,
  ChangeDetectionStrategy,
  computed,
  input,
  signal,
  ElementRef,
  inject,
  afterNextRender,
  type OnDestroy,
} from '@angular/core';
import {DatePipe, CurrencyPipe, NgOptimizedImage} from '@angular/common';
import {RouterLink} from '@angular/router';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import type {EventVisibility} from '@shared/domain/event-visibility';

export interface EventCardData {
  _id: string; // intentionally string, not Id<'events'> — UI components don't import Convex types
  title: string;
  description?: string;
  date: string;
  location?: string;
  price: number;
  totalTickets: number;
  soldCount?: number;
  isSoldOut?: boolean;
  ticketSalesStatus?: 'active' | 'paused' | 'ended';
  visibility?: EventVisibility;
  posterUrl?: string | null;
}

@Component({
  selector: 'app-event-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    CurrencyPipe,
    RouterLink,
    NgOptimizedImage,
    ZardButtonComponent,
    ZardCardComponent,
  ],
  host: {
    // Mark the host element as the container query context so child layout
    // responds to the card's own rendered width, not the viewport.
    class: '@container',
  },
  template: `
    <z-card
      data-testid="event-card"
      [zVariant]="cardVariant()"
      [class]="cardClasses()"
      role="article"
      [attr.aria-label]="'Event: ' + event().title"
    >
      <!-- Poster image projected into z-card's image slot.
           Stacked  (< 600px): full width, 4/5 aspect ratio, border-b
           Featured (≥ 600px): fixed ~40% width, full height, border-r, no border-b -->
      @if (event().posterUrl) {
        <a
          card-image
          class="relative block aspect-4/5 flex-shrink-0 overflow-hidden rounded-t-xl border-b border-border bg-muted @[600px]:aspect-auto @[600px]:w-2/5 @[600px]:rounded-t-none @[600px]:rounded-l-xl @[600px]:border-r @[600px]:border-b-0"
          [routerLink]="['/events', event()._id]"
          [attr.aria-label]="'View details for ' + event().title"
        >
          <img
            [ngSrc]="event().posterUrl!"
            [alt]="event().title + ' poster'"
            fill
            [priority]="priority()"
            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
            class="object-cover"
          />
        </a>
      } @else {
        <a
          card-image
          data-testid="event-card-poster-placeholder"
          class="relative block aspect-4/5 flex-shrink-0 overflow-hidden rounded-t-xl border-b border-border bg-gradient-to-br from-[var(--card)] via-[var(--muted)] to-[var(--card)] @[600px]:aspect-auto @[600px]:w-2/5 @[600px]:rounded-t-none @[600px]:rounded-l-xl @[600px]:border-r @[600px]:border-b-0"
          [routerLink]="['/events', event()._id]"
          [attr.aria-label]="'View details for ' + event().title"
        >
          <!-- Decorative texture lines for posterless events -->
          <div
            class="absolute inset-0 opacity-10"
            style="background-image: repeating-linear-gradient(135deg, var(--foreground) 0, var(--foreground) 1px, transparent 0, transparent 50%); background-size: 12px 12px;"
          ></div>
          <div class="absolute inset-0 flex items-center justify-center">
            <span
              class="line-clamp-3 px-4 text-center font-display text-4xl leading-none font-black tracking-tighter text-foreground/10 uppercase select-none @[600px]:text-5xl"
            >
              {{ event().title }}
            </span>
          </div>
        </a>
      }

      <!-- Content column: grows to fill remaining space -->
      <div class="flex min-w-0 flex-1 flex-col p-5 @[600px]:p-7">
        <h3
          data-testid="event-card-title"
          class="mb-2 font-display text-xl font-bold tracking-tight text-foreground uppercase @[600px]:text-2xl"
        >
          <a
            [routerLink]="['/events', event()._id]"
            class="text-foreground hover:underline"
          >
            {{ event().title }}
          </a>
        </h3>

        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p
            data-testid="event-card-date"
            class="font-mono text-sm font-bold text-muted-foreground"
          >
            {{ event().date | date: 'mediumDate' }},
            {{ event().date | date: 'shortTime' }}
          </p>
          @if (event().location) {
            <p
              data-testid="event-card-location"
              class="rounded-full border border-border px-2 py-0.5 font-mono text-xs tracking-wider text-muted-foreground uppercase"
            >
              {{ event().location }}
            </p>
          }
        </div>

        <p
          class="mb-6 line-clamp-3 grow font-sans text-sm text-card-foreground/80 @[600px]:line-clamp-4"
        >
          {{ event().description || 'No description provided.' }}
        </p>

        @if (isSoldOut()) {
          <span
            data-testid="event-card-sold-out"
            class="mb-3 inline-block rounded-full border border-destructive px-2 py-0.5 font-mono text-xs tracking-widest text-destructive uppercase"
          >
            SOLD OUT
          </span>
        }

        <!-- Footer: pinned to bottom of the content column -->
        <div
          class="mt-auto grid w-full grid-cols-2 gap-3 border-t border-border pt-4"
        >
          <a
            z-button
            data-testid="event-card-more-info"
            zType="outline"
            [routerLink]="['/events', event()._id]"
            class="flex-1"
            [attr.aria-label]="'More information about ' + event().title"
          >
            More Info
          </a>
          @if (showBuyButton()) {
            <z-button
              data-testid="event-card-buy"
              zType="default"
              [routerLink]="isBuyDisabled() ? null : ['/events', event()._id]"
              class="flex-1"
              [attr.aria-label]="'Get tickets for ' + event().title"
              [zDisabled]="isBuyDisabled()"
            >
              Tickets
              <span class="ml-1 font-mono opacity-80">
                {{ event().price / 100 | currency: 'USD' }}
              </span>
            </z-button>
          }
        </div>
      </div>
    </z-card>
  `,
})
export class EventCardComponent implements OnDestroy {
  readonly event = input.required<EventCardData>();
  readonly priority = input(false);
  readonly showBuyButton = input(true);

  readonly isSoldOut = computed(() => {
    const e = this.event();
    if (e.ticketSalesStatus === 'ended') return true;
    return e.isSoldOut ?? false;
  });

  readonly isPaused = computed(
    () => this.event().ticketSalesStatus === 'paused',
  );

  /** True when buy button should be disabled (sold out or sales paused). */
  readonly isBuyDisabled = computed(() => this.isSoldOut() || this.isPaused());

  // Track the rendered width of the host element to derive the card variant.
  private readonly containerWidth = signal(0);
  private readonly isWide = computed(() => this.containerWidth() >= 600);

  /** Variant passed to z-card — switches flex direction at 600 px. */
  readonly cardVariant = computed(() =>
    this.isWide() ? 'horizontal' : 'default',
  );

  /** Extra classes passed to z-card's host: hover effects, full height, and gap suppression. */
  readonly cardClasses = computed(() =>
    [
      'h-full gap-0 pt-0',
      'transition-[transform,border-color] duration-300',
      'motion-safe:hover:scale-[1.01] hover:border-foreground/50',
    ].join(' '),
  );

  private readonly host = inject(ElementRef<HTMLElement>);
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    afterNextRender(() => {
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          this.containerWidth.set(entry.contentRect.width);
        }
      });
      this.resizeObserver.observe(this.host.nativeElement as Element);
    });
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
}
