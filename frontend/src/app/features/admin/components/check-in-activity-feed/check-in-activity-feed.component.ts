import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
} from '@angular/core';
import { injectQuery } from 'convex-angular';
import { api } from '@convex/_generated/api';
import { type Id } from '@convex/_generated/dataModel';
import { type FunctionReturnType } from 'convex/server';
import { logger } from '@/utils/logger';

type RecentCheckInEntry = FunctionReturnType<typeof api.events.analytics.getRecentCheckIns>[number];

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
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
          <span class="font-mono text-sm uppercase tracking-widest text-muted-foreground">
            WAITING FOR FIRST SCAN
          </span>
        </div>
      } @else {
        <!-- Vertical ticker with hairline left rule -->
        <div class="border-l border-border/40 pl-4 space-y-3">
          @for (entry of entries(); track entry.ticketId) {
            <div
              class="feed-entry-enter flex items-baseline gap-3"
              data-testid="feed-entry"
              [attr.data-ticket-id]="entry.ticketId"
            >
              <!-- Space Mono timestamp in burnt amber -->
              <span
                class="font-mono text-xs text-amber-600 dark:text-amber-400 tabular-nums shrink-0 leading-tight"
                data-testid="feed-entry-timestamp"
                aria-label="Checked in at {{ formatTimestamp(entry.checkedInAt) }}"
              >{{ formatTimestamp(entry.checkedInAt) }}</span>

              <!-- Attendee name in Inter -->
              <span
                class="text-sm font-sans text-foreground leading-tight truncate"
                data-testid="feed-entry-name"
              >{{ entry.attendeeName }}</span>

              <!-- Tier in muted plum -->
              <span
                class="font-mono text-2xs uppercase tracking-wider text-primary/60 shrink-0 leading-tight"
                data-testid="feed-entry-tier"
              >{{ entry.tierName }}</span>
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
    () => ({ eventId: this.eventId(), limit: 20 }),
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
        logger.error('[CheckInActivityFeed] Failed to load recent check-ins', err);
      }
    });
  }
}
