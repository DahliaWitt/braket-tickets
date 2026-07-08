import {
  afterNextRender,
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  Injector,
  runInInjectionContext,
} from '@angular/core';
import {UpperCasePipe} from '@angular/common';
import {AuthService} from '@/core/services/auth.service';
import {PaymentService} from '@/features/tickets/services/payment.service';
import {ResaleService} from '@/features/tickets/services/resale.service';
import {extractErrorMessage} from '@/core/utils/error-message.utils';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {AppQrComponent} from '../../components/qr/qr.component';
import {RouterLink} from '@angular/router';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {ZardTooltipDirective} from '@ui/components/primitives/tooltip/tooltip';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import type {FunctionArgs} from 'convex/server';
import {injectQuery, injectQueries, skipToken} from 'convex-angular';

import {type Ticket} from '../../models/ticket.model';
import {type BatchAvailability} from '@/features/admin/services/events.service';
import type {ResaleListingStatus} from '@shared/domain/resale-listing-status';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {formatUsdCents} from '@shared/pricing/pricing-summary';
import {EventDatePipe} from '@/utils/event-date.pipe';
import {EventEndTimePipe} from '@/utils/event-end-time.pipe';

/**
 * Max event ids per getBatchAvailability call. Mirrors the backend
 * `eventIds` array cap; the service's copy is not exported, so define locally.
 */
const MAX_EVENT_IDS_PER_BATCH = 50;

/** Resale listing data mapped to a ticket */
interface TicketResaleInfo {
  listingId: string;
  status: ResaleListingStatus;
}

@Component({
  selector: 'app-tickets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EventDatePipe,
    EventEndTimePipe,
    UpperCasePipe,
    RouterLink,
    ZardCardComponent,
    AppQrComponent,
    ZardButtonComponent,
    ZardIconComponent,
    ZardSkeletonComponent,
    ZardTooltipDirective,
    EmptyStateComponent,
    ContentLayoutComponent,
  ],
  template: `
    <app-content-layout>
      <div class="flex grow flex-col py-8">
        <div
          class="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"
        >
          <h1
            class="flex items-center font-display text-2xl font-bold tracking-tight text-foreground uppercase sm:text-3xl lg:text-4xl"
          >
            MY TICKETS
            @if (isLoading() && tickets().length > 0) {
              <span
                class="animate-in fade-in zoom-in ml-4 inline-flex items-center gap-1.5 rounded-full border border-secondary/20 bg-secondary/10 px-2 py-0.5 duration-300"
              >
                <span
                  class="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary"
                ></span>
                <span
                  class="font-mono text-[8px] tracking-widest text-secondary uppercase"
                  >Refreshing</span
                >
              </span>
            }
          </h1>
        </div>

        @if (hasLoadError()) {
          <div
            class="animate-in fade-in zoom-in mx-auto flex w-full max-w-xl flex-col items-center justify-center py-16 text-center duration-500"
            data-testid="tickets-error-state"
            role="alert"
            aria-live="assertive"
          >
            <div
              class="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/20"
            >
              <svg
                class="h-10 w-10 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h2
              class="mb-4 font-display text-2xl font-bold tracking-tight text-destructive uppercase md:text-3xl"
            >
              hit a snag
            </h2>
            <p class="mb-8 font-sans text-lg text-muted-foreground">
              couldn't load your tickets — try again later
            </p>
            <a
              routerLink="/"
              class="font-mono text-sm tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
            >
              ← Back to Home
            </a>
          </div>
        } @else {
          <div class="grid gap-6 md:grid-cols-2">
            @for (ticket of tickets(); track ticket._id; let i = $index) {
              <z-card
                [class]="
                  'ph-no-capture group animate-in fade-in slide-in-from-bottom-8 overflow-hidden border-border bg-card/80 transition-transform duration-300 motion-safe:hover:scale-[1.01] ' +
                  (i === 0
                    ? 'delay-75'
                    : i === 1
                      ? 'delay-150'
                      : i === 2
                        ? 'delay-225'
                        : 'delay-300')
                "
                [zTitle]="ticketTitle"
                role="article"
                data-testid="ticket-card"
                [attr.aria-label]="
                  'Ticket for ' +
                  (ticket.resolvedEvent?.title || 'event') +
                  (getResaleInfo(ticket._id)?.status
                    ? ', ' + getResaleInfo(ticket._id)?.status
                    : '')
                "
              >
                <ng-template #ticketTitle>
                  <div class="flex w-full items-start justify-between">
                    <div>
                      <div
                        class="font-display tracking-wide text-secondary uppercase"
                        data-testid="ticket-event-title"
                      >
                        {{ ticket.resolvedEvent?.title }}
                      </div>
                      <p
                        class="mt-1 font-mono text-2xs text-muted-foreground uppercase"
                      >
                        @if (ticket.resolvedEvent?.date; as eventDate) {
                          {{ eventDate | eventDate: 'longDate' }},
                          {{ eventDate | eventDate: 'shortTime'
                          }}{{
                            ticket.resolvedEvent.endDate
                              | eventEndTime: eventDate
                          }}
                        }
                      </p>
                      <p
                        class="mono-label mt-0.5 text-2xs text-muted-foreground"
                        data-testid="ticket-tier"
                      >
                        {{ ticket.tier || 'REGULAR' }} ADMISSION
                      </p>
                    </div>
                    <!-- Status badge: shows resale status when listed/pending, otherwise normal ticket status -->
                    @if (getResaleInfo(ticket._id); as resale) {
                      @switch (resale.status) {
                        @case ('listed') {
                          <span
                            data-testid="ticket-status-badge"
                            class="rounded border border-info/30 bg-info/10 px-2 py-0.5 font-mono text-2xs text-info"
                          >
                            LISTED
                          </span>
                        }
                        @case ('pending') {
                          <span
                            data-testid="ticket-status-badge"
                            class="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 font-mono text-2xs text-warning"
                          >
                            PENDING
                          </span>
                        }
                      }
                    } @else {
                      <span
                        data-testid="ticket-status-badge"
                        class="rounded border px-2 py-0.5 font-mono text-2xs"
                        [class.border-success/30]="ticket.status === 'valid'"
                        [class.text-success]="ticket.status === 'valid'"
                        [class.border-border]="ticket.status !== 'valid'"
                        [class.text-muted-foreground]="
                          ticket.status !== 'valid'
                        "
                      >
                        {{ ticket.status | uppercase }}
                      </span>
                    }
                  </div>
                </ng-template>

                <div class="flex flex-col items-center py-6">
                  <div
                    class="shadow-[0_0_15px_hsl(var(--success)/0.2)]"
                    [class.opacity-50]="
                      getResaleInfo(ticket._id)?.status === 'listed' ||
                      getResaleInfo(ticket._id)?.status === 'pending'
                    "
                  >
                    <app-qr [data]="ticket._id" class="block" />
                  </div>
                  <div
                    class="mt-4 flex min-w-0 items-center gap-2 overflow-hidden text-muted-foreground"
                  >
                    <p
                      class="min-w-0 font-mono text-2xs tracking-tighter break-all uppercase select-all"
                    >
                      {{ ticket._id }}
                    </p>
                    <button
                      type="button"
                      (click)="copyId(ticket._id)"
                      class="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-sm p-2 transition-colors hover:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      [attr.aria-label]="'Copy ticket ID ' + ticket._id"
                      [zTooltip]="
                        copiedId() === ticket._id ? 'Copied!' : 'Copy ID'
                      "
                      zPosition="top"
                    >
                      <z-icon
                        [zType]="copiedId() === ticket._id ? 'check' : 'copy'"
                        class="h-4 w-4"
                        [class.text-success]="copiedId() === ticket._id"
                      />
                    </button>
                  </div>

                  @if (ticket.status === 'valid') {
                    <button
                      type="button"
                      z-button
                      zType="outline"
                      class="mt-3 min-h-11 w-full border-border/50 font-mono text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground"
                      data-testid="ticket-download-pdf"
                      [attr.aria-label]="'Download ticket PDF ' + ticket._id"
                      [zDisabled]="isDownloadingPdf() === ticket._id"
                      (click)="downloadTicketPdf(ticket._id)"
                    >
                      @if (isDownloadingPdf() === ticket._id) {
                        <z-icon zType="loader-circle" class="animate-spin" />
                        Generating...
                      } @else {
                        <z-icon zType="file-text" class="h-4 w-4" />
                        Download PDF
                      }
                    </button>
                  }

                  <!-- Resale section -->
                  @if (isResaleEnabled(ticket)) {
                    @if (getResaleInfo(ticket._id); as resale) {
                      <!-- State C/D: Listed for resale -->
                      @if (resale.status === 'listed') {
                        @if (isEventSoldOut(ticket.eventId)) {
                          <!-- State D: Listed + Sold Out (active for buyers) -->
                          <div
                            data-testid="available-banner"
                            class="mt-4 w-full space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3"
                          >
                            <div class="flex items-start gap-2">
                              <z-icon
                                zType="circle-check"
                                class="mt-0.5 shrink-0 text-primary"
                              />
                              <p
                                class="font-mono text-xs leading-relaxed text-primary"
                              >
                                Your ticket is available for resale. Buyers can
                                now purchase it.
                              </p>
                            </div>
                            <p
                              class="ml-6 font-mono text-2xs tracking-widest text-primary/60 uppercase"
                            >
                              {{ getResaleQueueCount(ticket.eventId) }}
                              listing{{
                                getResaleQueueCount(ticket.eventId) !== 1
                                  ? 's'
                                  : ''
                              }}
                              in queue
                            </p>
                          </div>
                        } @else {
                          <!-- State C: Listed + Not Sold Out (queued) -->
                          <div
                            data-testid="queued-banner"
                            class="mt-4 w-full space-y-2 rounded-lg border border-secondary/20 bg-secondary/5 p-3"
                          >
                            <div class="flex items-start gap-2">
                              <z-icon
                                zType="info"
                                class="mt-0.5 shrink-0 text-info"
                              />
                              <p
                                class="font-mono text-xs leading-relaxed text-info/80"
                              >
                                Your ticket is queued for resale. It becomes
                                available for purchase when the event sells out.
                              </p>
                            </div>
                            <p
                              class="ml-6 font-mono text-2xs tracking-widest text-info/60 uppercase"
                            >
                              {{ getResaleQueueCount(ticket.eventId) }}
                              listing{{
                                getResaleQueueCount(ticket.eventId) !== 1
                                  ? 's'
                                  : ''
                              }}
                              in queue
                            </p>
                          </div>
                        }
                        <!-- Cancel button -->
                        <button
                          type="button"
                          z-button
                          zType="outline"
                          class="mt-3 min-h-11 w-full border-destructive/30 font-mono text-xs tracking-widest text-destructive uppercase hover:bg-destructive/10"
                          aria-label="Cancel resale listing"
                          (click)="
                            cancelResaleListing(resale.listingId, ticket._id)
                          "
                          [zDisabled]="isCancellingListing() === ticket._id"
                          [attr.aria-busy]="
                            isCancellingListing() === ticket._id
                          "
                        >
                          @if (isCancellingListing() === ticket._id) {
                            <z-icon
                              zType="loader-circle"
                              class="animate-spin"
                            />
                            Cancelling...
                          } @else {
                            <z-icon zType="x" />
                            Cancel Listing
                          }
                        </button>
                      }

                      <!-- State E: Pending (buyer mid-checkout) -->
                      @if (resale.status === 'pending') {
                        <div
                          class="mt-4 w-full rounded-lg border border-warning/20 bg-warning/10 p-3"
                        >
                          <div class="flex items-start gap-2">
                            <span class="mt-0.5 flex shrink-0">
                              <z-icon
                                zType="loader-circle"
                                class="animate-spin text-warning"
                              />
                            </span>
                            <p
                              class="font-mono text-xs leading-relaxed text-warning"
                            >
                              A buyer is currently checking out with your
                              ticket. You'll be notified when the sale
                              completes.
                            </p>
                          </div>
                        </div>
                      }
                    } @else if (ticket.status === 'valid') {
                      <!-- State B: Eligible to list for resale -->
                      @if (resaleConfirmationTicketId() === ticket._id) {
                        <div
                          class="animate-in fade-in slide-in-from-bottom-2 mt-4 w-full rounded-xl border border-primary/30 bg-primary/10 p-4 text-left duration-200"
                          data-testid="resale-confirmation-panel"
                          role="region"
                          aria-label="Confirm resale listing"
                          aria-live="polite"
                          aria-atomic="true"
                        >
                          <div class="flex items-start gap-3">
                            <z-icon
                              zType="repeat"
                              class="mt-0.5 h-4 w-4 shrink-0 text-primary"
                            />
                            <div class="min-w-0">
                              <p
                                class="font-mono text-xs tracking-widest text-primary uppercase"
                              >
                                Ready to list it?
                              </p>
                              <p
                                class="mt-1 text-xs leading-relaxed text-muted-foreground"
                              >
                                We'll queue this ticket for resale. Buyers can
                                pick it up once the event sells out; you can
                                cancel before then.
                              </p>
                              @if (resaleDisclosure(ticket); as disclosure) {
                                <dl
                                  class="mt-3 grid gap-1 rounded border border-border/60 bg-background/50 p-3 font-mono text-2xs"
                                  data-testid="resale-seller-disclosure"
                                >
                                  <div class="flex justify-between gap-3">
                                    <dt class="text-muted-foreground">
                                      Original ticket price
                                    </dt>
                                    <dd class="text-foreground">
                                      {{ disclosure.originalPrice }}
                                    </dd>
                                  </div>
                                  <div class="flex justify-between gap-3">
                                    <dt class="text-muted-foreground">
                                      Resale fee
                                    </dt>
                                    <dd class="text-foreground">
                                      {{ disclosure.feePercent }}% ({{
                                        disclosure.feeAmount
                                      }})
                                    </dd>
                                  </div>
                                  <div class="flex justify-between gap-3">
                                    <dt class="text-muted-foreground">
                                      Expected refund
                                    </dt>
                                    <dd class="text-foreground">
                                      {{ disclosure.expectedRefund }}
                                    </dd>
                                  </div>
                                </dl>
                                <p
                                  class="pt-2 font-mono text-2xs leading-relaxed text-muted-foreground"
                                  data-testid="resale-seller-disclosure-note"
                                >
                                  Stripe processing fees from the original
                                  purchase are not returned; estimated lost
                                  processing fee:
                                  {{ disclosure.lostProcessingFee }}.
                                </p>
                              } @else {
                                <div
                                  class="mt-3 rounded border border-warning/30 bg-warning/10 p-3 font-mono text-2xs leading-relaxed text-warning"
                                  data-testid="resale-seller-disclosure-unavailable"
                                >
                                  We can't calculate the resale payout for this
                                  ticket yet. Contact support before listing it.
                                </div>
                              }
                            </div>
                          </div>
                          <div class="mt-4 grid gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              z-button
                              zType="default"
                              class="min-h-11 font-mono text-xs tracking-widest uppercase"
                              [id]="resaleConfirmButtonId(ticket._id)"
                              data-testid="ticket-confirm-resale"
                              aria-label="Confirm resale listing"
                              (click)="confirmListForResale(ticket._id)"
                              [zDisabled]="
                                isListingForResale() === ticket._id ||
                                !canConfirmResaleListing(ticket)
                              "
                              [attr.aria-busy]="
                                isListingForResale() === ticket._id
                              "
                            >
                              @if (isListingForResale() === ticket._id) {
                                <z-icon
                                  zType="loader-circle"
                                  class="animate-spin"
                                />
                                Listing...
                              } @else {
                                Confirm listing
                              }
                            </button>
                            <button
                              type="button"
                              z-button
                              zType="outline"
                              class="min-h-11 border-border/60 font-mono text-xs tracking-widest text-muted-foreground uppercase hover:text-foreground"
                              data-testid="ticket-cancel-resale-flow"
                              aria-label="Keep this ticket instead of listing it"
                              (click)="closeResaleListingFlow(ticket._id)"
                              [zDisabled]="isListingForResale() === ticket._id"
                            >
                              Keep ticket
                            </button>
                          </div>
                        </div>
                      } @else {
                        <button
                          type="button"
                          z-button
                          zType="outline"
                          class="mt-4 min-h-11 w-full border-primary/50 font-mono text-xs tracking-widest text-primary uppercase hover:bg-primary/10"
                          aria-label="List this ticket for resale"
                          (click)="openResaleListingFlow(ticket._id)"
                          [zDisabled]="isListingForResale() !== null"
                        >
                          <z-icon zType="repeat" class="mr-2" />
                          List this ticket for resale
                        </button>
                      }
                    }
                  }
                </div>
              </z-card>
            } @empty {
              @if (showTicketsSkeleton()) {
                <div
                  class="h-64 overflow-hidden rounded-xl border border-border bg-card/80"
                >
                  <z-skeleton class="h-full w-full rounded-none opacity-50" />
                </div>
                <div
                  class="hidden h-64 overflow-hidden rounded-xl border border-border bg-card/80 md:block"
                >
                  <z-skeleton class="h-full w-full rounded-none opacity-50" />
                </div>
              } @else {
                <div class="md:col-span-2">
                  <app-empty-state
                    title="No tickets found"
                    description="You haven't purchased any tickets yet."
                  >
                    <z-button
                      routerLink="/"
                      zType="outline"
                      class="mt-4 border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                      >BROWSE EVENTS</z-button
                    >
                  </app-empty-state>
                </div>
              }
            }
          </div>
        }
        <!-- end @else (no error) -->
      </div>
    </app-content-layout>
  `,
})
export class TicketsComponent {
  private auth = inject(AuthService);
  private paymentService = inject(PaymentService);
  private resaleService = inject(ResaleService);
  private browser = inject(BrowserPlatformService);
  private injector = inject(Injector);

  // Consume the service-based resource. `ticketsResource.value` is a plain
  // computed signal (not an Angular resource), so it never throws on error —
  // safe to read directly.
  readonly tickets = this.paymentService.ticketsResource.value;
  isLoading = this.paymentService.ticketsResource.isLoading;
  /**
   * Skeleton gate for the empty-list branch. Includes the optimistic
   * activation window (route admitted on a cached credential, auth not yet
   * settled) so a signed-in buyer never flashes "No tickets found" while the
   * profile-keyed query has not started.
   */
  readonly showTicketsSkeleton = computed(
    () => this.isLoading() || !this.auth.authSettled(),
  );
  readonly copiedId = signal<string | null>(null);
  readonly isDownloadingPdf = signal<string | null>(null);

  // Resale state
  readonly isListingForResale = signal<string | null>(null);
  readonly isCancellingListing = signal<string | null>(null);
  readonly resaleConfirmationTicketId = signal<string | null>(null);
  private readonly optimisticResaleMap = signal<
    ReadonlyMap<string, TicketResaleInfo>
  >(new Map());
  private readonly hiddenResaleListingIds = signal<ReadonlySet<string>>(
    new Set(),
  );

  /** Unique event IDs from the user's tickets (for batch queries) */
  private readonly uniqueEventIds = computed(() => {
    const ids = new Set(this.tickets().map((t) => t.eventId));
    return [...ids];
  });

  /**
   * Live availability subscriptions, one per chunk of event ids. `now` is
   * frozen at subscribe time (Date.now() is not a signal), mirroring
   * event-details' availabilityQuery: the callback re-runs only when
   * uniqueEventIds() changes, so there is no minute-timer resubscribe.
   */
  private readonly availabilityQueries = injectQueries(() => {
    const eventIds = this.uniqueEventIds();
    if (eventIds.length === 0) return {};
    const now = Math.floor(Date.now() / 60000) * 60000;
    const defs: Record<
      string,
      {
        query: typeof api.events.public.getBatchAvailability;
        args: FunctionArgs<typeof api.events.public.getBatchAvailability>;
      }
    > = {};
    for (let i = 0; i < eventIds.length; i += MAX_EVENT_IDS_PER_BATCH) {
      const chunk = eventIds.slice(
        i,
        i + MAX_EVENT_IDS_PER_BATCH,
      ) as Id<'events'>[];
      defs[`chunk_${i / MAX_EVENT_IDS_PER_BATCH}`] = {
        query: api.events.public.getBatchAvailability,
        args: {eventIds: chunk, now},
      };
    }
    return defs;
  });

  /** Merged availability map across all chunk subscriptions. */
  private readonly availabilityMap = computed<BatchAvailability>(() => {
    const merged: BatchAvailability = {};
    for (const chunk of Object.values(this.availabilityQueries.results())) {
      if (chunk) Object.assign(merged, chunk);
    }
    return merged;
  });

  /** True when either the tickets query or any availability chunk has errored */
  readonly hasLoadError = computed(
    () =>
      !!this.paymentService.ticketsResource.error() ||
      Object.values(this.availabilityQueries.statuses()).some(
        (s) => s === 'error',
      ),
  );

  /** Realtime resale listings for the user's tickets, keyed by event */
  private readonly resaleListingsQuery = injectQuery(
    api.resale.listings.getMyResaleListingsBatch,
    () => {
      const eventIds = this.uniqueEventIds();
      if (eventIds.length === 0) return skipToken;
      return {
        eventIds,
      };
    },
  );

  /** Map of ticketId -> active resale info for O(1) lookup */
  private readonly resaleMap = computed(() => {
    const listings = this.resaleListingsQuery.data() ?? {};
    const hiddenListingIds = this.hiddenResaleListingIds();
    const map = new Map<string, TicketResaleInfo>();
    for (const eventListings of Object.values(listings)) {
      for (const listing of eventListings) {
        if (
          !hiddenListingIds.has(listing._id) &&
          (listing.status === 'listed' || listing.status === 'pending')
        ) {
          map.set(listing.ticketId, {
            listingId: listing._id,
            status: listing.status,
          });
        }
      }
    }
    for (const [ticketId, resale] of this.optimisticResaleMap()) {
      if (!hiddenListingIds.has(resale.listingId) && !map.has(ticketId)) {
        map.set(ticketId, resale);
      }
    }
    return map;
  });

  /** Get resale info for a specific ticket */
  getResaleInfo(ticketId: string): TicketResaleInfo | undefined {
    return this.resaleMap().get(ticketId);
  }

  /** Check if resale is enabled for a ticket's event */
  isResaleEnabled(ticket: Ticket): boolean {
    // Check from resolved event first (avoids waiting for availability fetch)
    const eventDoc = ticket.resolvedEvent;
    if (eventDoc && 'resaleEnabled' in eventDoc) {
      return eventDoc.resaleEnabled === true;
    }
    // Fallback to availability data — map is {} while chunks load
    const avail = this.availabilityMap();
    const eventAvail = avail[ticket.eventId];
    if (eventAvail && 'resaleEnabled' in eventAvail) {
      return eventAvail.resaleEnabled === true;
    }
    return false;
  }

  /** Check if an event is sold out */
  isEventSoldOut(eventId: string): boolean {
    const avail = this.availabilityMap();
    const eventAvail = avail[eventId];
    if (eventAvail && 'isSoldOut' in eventAvail) {
      return eventAvail.isSoldOut;
    }
    return false;
  }

  /** Get the number of resale listings in queue for an event */
  getResaleQueueCount(eventId: string): number {
    const avail = this.availabilityMap();
    const eventAvail = avail[eventId];
    if (eventAvail && 'resaleAvailable' in eventAvail) {
      return eventAvail.resaleAvailable ?? 0;
    }
    return 0;
  }

  resaleDisclosure(ticket: Ticket): {
    originalPrice: string;
    feePercent: string;
    feeAmount: string;
    expectedRefund: string;
    lostProcessingFee: string;
  } | null {
    const settlement = ticket.resaleSellerSettlement;
    const resaleFeePct = ticket.resolvedEvent?.resaleFeePct ?? 0;
    if (!settlement) return null;

    return {
      originalPrice: formatUsdCents(settlement.sellerPaidAmount),
      feePercent: resaleFeePct.toFixed(1).replace(/\.0$/, ''),
      feeAmount: formatUsdCents(settlement.resaleFeeCents),
      expectedRefund: formatUsdCents(settlement.sellerRefundAmount),
      lostProcessingFee: formatUsdCents(settlement.lostProcessingFeeCents),
    };
  }

  canConfirmResaleListing(ticket: Ticket): boolean {
    return ticket.resaleSellerSettlement !== undefined;
  }

  openResaleListingFlow(ticketId: string) {
    if (this.isListingForResale() !== null || this.getResaleInfo(ticketId))
      return;
    this.resaleConfirmationTicketId.set(ticketId);
    this.focusConfirmResaleButton(ticketId);
  }

  closeResaleListingFlow(ticketId: string) {
    if (this.isListingForResale() === ticketId) return;
    if (this.resaleConfirmationTicketId() === ticketId) {
      this.resaleConfirmationTicketId.set(null);
    }
  }

  async confirmListForResale(ticketId: string) {
    if (this.isListingForResale() !== null || this.getResaleInfo(ticketId))
      return;
    const ticket = this.tickets().find(
      (candidate) => candidate._id === ticketId,
    );
    if (!ticket || !this.canConfirmResaleListing(ticket)) {
      toast.error(
        "We can't calculate the resale payout for this ticket yet. Contact support before listing it.",
      );
      return;
    }
    this.isListingForResale.set(ticketId);
    try {
      const listingId = await this.resaleService.listTicketForResale(ticketId);
      this.optimisticResaleMap.update((current) => {
        const next = new Map(current);
        next.set(ticketId, {listingId, status: 'listed'});
        return next;
      });
      this.resaleConfirmationTicketId.set(null);
      toast.success('Ticket listed for resale');
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err));
      logger.error('Failed to list ticket for resale', err);
    } finally {
      this.isListingForResale.set(null);
    }
  }

  resaleConfirmButtonId(ticketId: string): string {
    return `ticket-resale-confirm-${ticketId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  }

  private focusConfirmResaleButton(ticketId: string): void {
    runInInjectionContext(this.injector, () => {
      afterNextRender({
        write: () => {
          if (this.resaleConfirmationTicketId() !== ticketId) return;
          this.browser.focusElementById(this.resaleConfirmButtonId(ticketId));
        },
      });
    });
  }

  async cancelResaleListing(listingId: string, ticketId: string) {
    this.isCancellingListing.set(ticketId);
    try {
      await this.resaleService.cancelResaleListing(listingId);
      this.hiddenResaleListingIds.update((current) => {
        const next = new Set(current);
        next.add(listingId);
        return next;
      });
      this.optimisticResaleMap.update((current) => {
        const next = new Map(current);
        next.delete(ticketId);
        return next;
      });
      toast.success('Resale listing cancelled');
    } catch (err: unknown) {
      toast.error(extractErrorMessage(err));
      logger.error('Failed to cancel resale listing', err);
    } finally {
      this.isCancellingListing.set(null);
    }
  }

  async downloadTicketPdf(ticketId: string) {
    this.isDownloadingPdf.set(ticketId);
    try {
      const dataUrl = await this.paymentService.getMyTicketPdf(
        ticketId as Id<'tickets'>,
      );
      this.browser.navigateWithAnchor(dataUrl, `ticket-${ticketId}.pdf`);
      toast.success('Ticket PDF download started.');
    } catch (err: unknown) {
      logger.error('Failed to download ticket PDF', err);
      toast.error('Failed to generate ticket PDF');
    } finally {
      this.isDownloadingPdf.set(null);
    }
  }

  copyId(id: string) {
    this.browser.writeClipboardText(id).then(
      () => {
        this.copiedId.set(id);
        toast.success('Ticket ID copied.');
        setTimeout(() => {
          if (this.copiedId() === id) {
            this.copiedId.set(null);
          }
        }, 2000);
      },
      (err) => {
        logger.error('Failed to copy ticket ID', err);
        toast.error('Failed to copy ticket ID.');
      },
    );
  }
}
