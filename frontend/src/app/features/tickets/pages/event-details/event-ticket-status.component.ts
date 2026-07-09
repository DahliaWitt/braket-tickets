import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';

import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

export type EventTicketSalesStatus = 'active' | 'paused' | 'ended' | null;

@Component({
  selector: 'app-event-ticket-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardIconComponent],
  host: {
    class: 'block',
  },
  template: `
    @if (
      isSoldOut() &&
      resaleEnabled() &&
      resaleAvailable() > 0 &&
      canSeeResale() &&
      ticketSalesStatus() === 'active'
    ) {
      <div
        role="status"
        aria-live="polite"
        data-testid="resale-available-banner"
        class="flex items-center gap-2 rounded border border-primary/30 bg-primary/10 px-4 py-3 font-mono text-xs tracking-wider text-primary uppercase"
      >
        <z-icon zType="repeat" />
        <div>
          <span class="font-display tracking-wide"
            >{{ resaleAvailable() }} Resale Ticket{{
              resaleAvailable() > 1 ? 's' : ''
            }}
            Available</span
          >
        </div>
      </div>
    } @else if (isSoldOut()) {
      <div data-testid="sold-out-banner" class="sold-out-status-stack">
        <div
          role="status"
          aria-live="polite"
          class="rounded border border-destructive/25 bg-destructive/10 px-4 py-4 text-destructive-text"
        >
          <div class="flex items-start gap-3">
            <z-icon zType="circle-alert" class="mt-0.5 h-4 w-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="font-mono text-xs tracking-widest uppercase">
                Sold Out
              </p>
              <p class="mt-1 text-sm leading-relaxed text-foreground/75">
                No tickets are available right now.
              </p>
            </div>
          </div>
        </div>

        @if (resaleEnabled() && !isSubscribedToResale() && canSeeResale()) {
          <button
            type="button"
            data-testid="resale-notify-btn"
            z-button
            zType="outline"
            class="group min-h-12 w-full justify-between border-primary/45 bg-primary/5 px-4 py-3 font-display text-sm tracking-wider text-primary uppercase hover:border-primary/70 hover:bg-primary/10"
            (click)="subscribeRequested.emit()"
            [zDisabled]="isSubscribing() || isSubscribedToResale()"
            [attr.aria-busy]="isSubscribing()"
            aria-label="Get notified when a resale ticket becomes available"
          >
            <span class="inline-flex min-w-0 items-center gap-2">
              @if (isSubscribing()) {
                <z-icon zType="loader-circle" class="animate-spin" />
                Subscribing...
              } @else {
                <z-icon zType="bell" />
                Get Notified
              }
            </span>
            @if (!isSubscribing()) {
              <z-icon
                zType="arrow-right"
                class="h-4 w-4 opacity-70 transition-transform group-hover:translate-x-0.5"
              />
            }
          </button>
        }

        @if (isSubscribedToResale() && canSeeResale()) {
          <div
            role="status"
            data-testid="resale-notify-subscribed"
            class="flex items-center justify-between gap-3 rounded border border-success/30 bg-success/10 px-4 py-3 text-success"
          >
            <span
              class="flex min-w-0 flex-1 items-center gap-2 font-mono text-xs tracking-wider uppercase"
            >
              <z-icon zType="bell-ring" />
              You'll be notified when a resale ticket becomes available
            </span>
            <button
              type="button"
              z-button
              zType="ghost"
              zSize="sm"
              class="shrink-0 text-success hover:bg-destructive/10 hover:text-destructive-text"
              (click)="unsubscribeRequested.emit()"
              [zDisabled]="isUnsubscribing()"
              [attr.aria-busy]="isUnsubscribing()"
              aria-label="Unsubscribe from resale notifications"
              data-testid="unsubscribe-resale-btn"
            >
              @if (isUnsubscribing()) {
                <z-icon zType="loader-circle" class="animate-spin" />
              } @else {
                <z-icon zType="bell-off" />
              }
            </button>
          </div>
        }
      </div>
    } @else if (ticketSalesStatus() === 'paused') {
      <div
        class="rounded border border-warning/40 bg-warning/10 px-4 py-3"
        data-testid="paused-sales-banner"
      >
        <div
          class="flex items-center gap-2 font-mono text-xs tracking-wider text-foreground uppercase dark:text-warning"
        >
          <z-icon zType="clock" />
          Ticket Sales Are Paused
        </div>
        <p class="mt-1 text-xs text-muted-foreground">
          Sales temporarily paused by the organizer
        </p>
      </div>
    } @else if (ticketSalesStatus() === 'ended') {
      <div
        class="flex items-center gap-2 rounded border border-destructive/20 bg-destructive/10 px-4 py-3 font-mono text-xs tracking-wider text-destructive-text uppercase"
      >
        <z-icon zType="circle-alert" />
        Ticket Sales Have Ended
      </div>
    }
  `,
  styles: `
    .sold-out-status-stack {
      display: grid;
      gap: 12px;
    }
  `,
})
export class EventTicketStatusComponent {
  readonly ticketSalesStatus = input.required<EventTicketSalesStatus>();
  readonly isSoldOut = input.required<boolean>();
  readonly resaleEnabled = input.required<boolean>();
  readonly resaleAvailable = input.required<number>();
  readonly canSeeResale = input.required<boolean>();
  readonly isSubscribedToResale = input.required<boolean>();
  readonly isSubscribing = input.required<boolean>();
  readonly isUnsubscribing = input.required<boolean>();

  readonly subscribeRequested = output<void>();
  readonly unsubscribeRequested = output<void>();
}
