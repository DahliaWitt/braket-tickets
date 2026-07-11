import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
} from '@angular/core';
import {injectQuery} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {type FunctionReturnType} from 'convex/server';
import {logger} from '@/utils/logger';
import {formatEventDate} from '@/utils/event-date-format';

type RecentCheckInEntry = FunctionReturnType<
  typeof api.events.analytics.getRecentCheckIns
>[number];

function formatTimestamp(ms: number): string {
  return formatEventDate(ms, 'HH:mm:ss') ?? '';
}

@Component({
  selector: 'app-check-in-activity-feed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      @keyframes slideInFromTop {
        from {
          opacity: 0;
          transform: translateY(-12px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .feed-entry-enter {
        animation: slideInFromTop 200ms ease-out forwards;
      }

      @media (prefers-reduced-motion: reduce) {
        .feed-entry-enter {
          animation: none;
        }
      }
    `,
  ],
  template: `
    <div
      class="relative"
      role="log"
      aria-label="Check-in activity feed"
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
    >
      @if (entries().length === 0) {
        <!-- Empty state -->
        <div
          class="flex items-center justify-center py-12"
          data-testid="feed-empty-state"
          aria-label="No check-ins yet"
        >
          <span
            class="font-mono text-sm tracking-widest text-muted-foreground uppercase"
          >
            WAITING FOR FIRST SCAN
          </span>
        </div>
      } @else {
        <!-- Vertical ticker with hairline left rule -->
        <div class="space-y-3 border-l border-border/40 pl-4">
          @for (entry of entries(); track entry.ticketId) {
            <div
              class="feed-entry-enter flex items-baseline gap-3"
              data-testid="feed-entry"
              [attr.data-ticket-id]="entry.ticketId"
            >
              <!-- Space Mono timestamp in burnt amber (accent token) -->
              <span
                class="shrink-0 font-mono text-xs leading-tight text-accent tabular-nums"
                data-testid="feed-entry-timestamp"
                aria-label="Checked in at {{
                  formatTimestamp(entry.checkedInAt)
                }}"
                >{{ formatTimestamp(entry.checkedInAt) }}</span
              >

              <!-- Attendee name in Inter -->
              <span
                class="truncate font-sans text-sm leading-tight text-foreground"
                data-testid="feed-entry-name"
                >{{ entry.attendeeName }}</span
              >

              <!-- Tier in muted plum -->
              <span
                class="shrink-0 font-mono text-2xs leading-tight tracking-wider text-primary/60 uppercase"
                data-testid="feed-entry-tier"
                >{{ entry.tierName }}</span
              >
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class CheckInActivityFeedComponent {
  readonly eventId = input.required<Id<'events'>>();

  private readonly recentCheckInsQuery = injectQuery(
    api.events.analytics.getRecentCheckIns,
    () => ({eventId: this.eventId(), limit: 20}),
  );

  readonly entries = computed((): RecentCheckInEntry[] => {
    const data = this.recentCheckInsQuery.data();
    if (!Array.isArray(data)) return [];
    return data;
  });

  readonly formatTimestamp = formatTimestamp;

  constructor() {
    effect(() => {
      const err = this.recentCheckInsQuery.error();
      if (err) {
        logger.error(
          '[CheckInActivityFeed] Failed to load recent check-ins',
          err,
        );
      }
    });
  }
}
