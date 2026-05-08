import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
} from '@angular/core';
import { injectQuery, skipToken } from 'convex-angular';
import { api } from '@convex/_generated/api';
import { type Id } from '@convex/_generated/dataModel';
import { logger } from '@/utils/logger';

export type CheckInMode = 'pre-event' | 'door-rush' | 'post-event';

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatHour(timestampMs: number): string {
  const d = new Date(timestampMs);
  const h = d.getHours();
  const start = h % 12 === 0 ? 12 : h % 12;
  const end = (h + 1) % 12 === 0 ? 12 : (h + 1) % 12;
  const startSuffix = h < 12 ? 'AM' : 'PM';
  const endSuffix = h + 1 < 12 ? 'AM' : 'PM';
  return `${start}–${end} ${endSuffix !== startSuffix ? startSuffix + '/' : ''}${endSuffix}`;
}

@Component({
  selector: 'app-check-in-summary-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center gap-0"
      role="region"
      aria-label="Check-in summary"
    >
      <!-- Dominant check-in rate numeral -->
      <div
        class="flex flex-col items-center justify-center pr-6 border-r border-border/40"
        data-testid="checkin-rate-block"
      >
        <span
          class="text-5xl sm:text-6xl font-display font-bold tracking-tight text-foreground leading-none"
          data-testid="checkin-rate"
          aria-label="Check-in rate"
        >{{ rateDisplay() }}</span>
        <span class="text-2xs font-mono uppercase tracking-widest text-muted-foreground mt-1">
          CHECKED IN
        </span>
      </div>

      <!-- Supporting stats -->
      <div class="flex flex-wrap items-stretch divide-x divide-border/40">
        <!-- Total scanned / total active -->
        <div class="flex flex-col items-center justify-center px-5 py-2">
          <span
            class="text-lg font-mono font-semibold text-foreground tabular-nums"
            data-testid="checkin-scanned"
          >{{ summary()?.checkedIn ?? 0 }}</span>
          <span class="text-2xs font-mono uppercase tracking-widest text-muted-foreground mt-0.5">
            of {{ summary()?.totalActive ?? 0 }}
          </span>
          <span class="text-2xs font-mono uppercase tracking-widest text-muted-foreground">SCANNED</span>
        </div>

        <!-- Last scan relative time -->
        <div class="flex flex-col items-center justify-center px-5 py-2">
          @if (summary()?.lastCheckInAt) {
            <span
              class="text-sm font-mono text-foreground tabular-nums"
              data-testid="checkin-last-scan"
              aria-label="Last scan time"
            >{{ lastScanRelative() }}</span>
          } @else {
            <span
              class="text-sm font-mono text-muted-foreground"
              data-testid="checkin-last-scan"
              aria-label="Last scan time"
            >—</span>
          }
          <span class="text-2xs font-mono uppercase tracking-widest text-muted-foreground mt-0.5">
            LAST SCAN
          </span>
        </div>

        <!-- Peak hour — post-event mode only -->
        @if (mode() === 'post-event') {
          <div class="flex flex-col items-center justify-center px-5 py-2">
            @if (postMortem()?.peakHourStartsAt) {
              <span
                class="text-sm font-mono text-foreground tabular-nums"
                data-testid="checkin-peak-hour"
                aria-label="Peak check-in hour"
              >{{ formatHour(postMortem()!.peakHourStartsAt!) }}</span>
              <span class="text-2xs font-mono text-muted-foreground mt-0.5">
                {{ postMortem()?.peakHourCount ?? 0 }} scans
              </span>
            } @else {
              <span
                class="text-sm font-mono text-muted-foreground"
                data-testid="checkin-peak-hour"
                aria-label="Peak check-in hour"
              >—</span>
            }
            <span class="text-2xs font-mono uppercase tracking-widest text-muted-foreground mt-0.5">
              PEAK HOUR
            </span>
          </div>
        }
      </div>
    </div>
  `,
})
export class CheckInSummaryStripComponent {
  readonly eventId = input.required<Id<'events'>>();
  readonly mode = input.required<CheckInMode>();

  private readonly summaryQuery = injectQuery(
    api.events.analytics.getEventCheckInSummary,
    () => ({ eventId: this.eventId() }),
  );

  private readonly postMortemQuery = injectQuery(
    api.events.analytics.getEventCheckInPostMortem,
    () => (this.mode() === 'post-event' ? { eventId: this.eventId() } : skipToken),
  );

  readonly summary = computed(() => this.summaryQuery.data() ?? null);
  readonly postMortem = computed(() => this.postMortemQuery.data() ?? null);

  readonly rateDisplay = computed(() => {
    const s = this.summary();
    if (!s) return '—';
    return `${Math.round(s.rate * 100)}%`;
  });

  readonly lastScanRelative = computed(() => {
    const s = this.summary();
    if (!s?.lastCheckInAt) return null;
    return relativeTime(s.lastCheckInAt);
  });

  readonly formatHour = formatHour;

  constructor() {
    effect(() => {
      const err = this.summaryQuery.error();
      if (err) {
        logger.error('[CheckInSummaryStrip] Failed to load check-in summary', err);
      }
    });
  }
}
