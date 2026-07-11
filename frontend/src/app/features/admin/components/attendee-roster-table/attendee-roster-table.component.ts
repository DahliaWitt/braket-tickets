import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {DatePipe} from '@angular/common';
import {injectConvex, injectPaginatedQuery, skipToken} from 'convex-angular';
import {ConvexError} from 'convex/values';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {type FunctionReturnType} from 'convex/server';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {logger} from '@/utils/logger';
import {toast} from 'ngx-sonner';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {formatEventDate} from '@/utils/event-date-format';

type RosterRow = FunctionReturnType<
  typeof api.events.analytics.getEventAttendeeRosterPage
>['page'][number];

function formatTimestampFull(ms: number): string {
  return formatEventDate(ms, 'HH:mm') ?? '';
}

@Component({
  selector: 'app-attendee-roster-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, ZardButtonComponent, ZardInputDirective],
  template: `
    <div class="space-y-4">
      <!-- Header row: search, toggle, export -->
      <div class="flex flex-wrap items-center gap-3">
        <!-- Inline search -->
        <div class="relative max-w-sm min-w-48 flex-1">
          <input
            zInput
            type="search"
            placeholder="Search attendees..."
            [value]="searchQuery()"
            (input.debounce.200)="onSearchInput($event)"
            class="w-full text-sm"
            aria-label="Search attendees by name or email"
            data-testid="roster-search"
          />
        </div>

        <!-- Show refunded toggle -->
        <label
          class="flex cursor-pointer items-center gap-2 select-none"
          data-testid="show-refunded-label"
        >
          <input
            type="checkbox"
            [checked]="showRefunded()"
            (change)="onToggleRefunded($event)"
            class="h-4 w-4 rounded border-border accent-primary"
            aria-label="Show refunded tickets"
            data-testid="show-refunded-toggle"
          />
          <span
            class="font-mono text-xs tracking-wider text-muted-foreground uppercase"
          >
            Show refunded
          </span>
        </label>

        <!-- Ghost export button — only visible when canExport is true -->
        @if (canExport()) {
          <button
            type="button"
            z-button
            zType="ghost"
            [zDisabled]="isExporting()"
            (click)="exportCsv()"
            class="ml-auto border border-border/50 font-mono text-xs tracking-widest uppercase"
            data-testid="export-csv-button"
            aria-label="Export roster as CSV"
          >
            @if (isExporting()) {
              Exporting...
            } @else {
              EXPORT.CSV
            }
          </button>
        }
      </div>

      <!-- Table -->
      <div class="overflow-x-auto rounded-lg border border-border/60">
        <table
          class="w-full font-sans text-sm"
          aria-label="Event attendee roster"
          data-testid="roster-table"
        >
          <thead>
            <tr class="border-b border-border/60 bg-muted/30">
              <th
                class="px-4 py-3 text-left font-mono text-xs tracking-wider text-muted-foreground uppercase"
              >
                Name
              </th>
              @if (showEmailColumn()) {
                <th
                  class="px-4 py-3 text-left font-mono text-xs tracking-wider text-muted-foreground uppercase"
                >
                  Email
                </th>
              }
              <th
                class="px-4 py-3 text-left font-mono text-xs tracking-wider text-muted-foreground uppercase"
              >
                Tier
              </th>
              <th
                class="hidden px-4 py-3 text-left font-mono text-xs tracking-wider text-muted-foreground uppercase sm:table-cell"
              >
                Purchased
              </th>
              <th
                class="px-4 py-3 text-left font-mono text-xs tracking-wider text-muted-foreground uppercase"
              >
                Status
              </th>
              <th
                class="px-4 py-3 text-left font-mono text-xs tracking-wider text-muted-foreground uppercase"
              >
                Checked in
              </th>
              <th
                class="hidden px-4 py-3 text-left font-mono text-xs tracking-wider text-muted-foreground uppercase md:table-cell"
              >
                By
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border/40">
            @if (isLoadingFirstPage()) {
              @for (i of skeletonRows; track i) {
                <tr>
                  <td
                    [attr.colspan]="showEmailColumn() ? 7 : 6"
                    class="px-4 py-3"
                  >
                    <div
                      class="h-4 w-full animate-pulse rounded bg-muted/60"
                    ></div>
                  </td>
                </tr>
              }
            } @else if (rows().length === 0) {
              <tr>
                <td
                  [attr.colspan]="showEmailColumn() ? 7 : 6"
                  class="px-4 py-8 text-center font-mono text-xs tracking-widest text-muted-foreground uppercase"
                  data-testid="roster-empty"
                >
                  @if (searchQuery()) {
                    NO RESULTS FOR &ldquo;{{ searchQuery() }}&rdquo;
                  } @else {
                    NO ATTENDEES YET
                  }
                </td>
              </tr>
            } @else {
              @for (row of rows(); track row.ticketId) {
                <tr
                  class="transition-colors hover:bg-muted/20"
                  data-testid="roster-row"
                  [attr.data-ticket-id]="row.ticketId"
                  [attr.data-email]="row.email ?? ''"
                >
                  <td class="px-4 py-3 text-foreground">
                    {{ row.attendeeName }}
                  </td>
                  @if (showEmailColumn()) {
                    <td
                      class="max-w-[220px] truncate px-4 py-3 font-mono text-xs text-muted-foreground"
                      [title]="row.email"
                    >
                      {{ row.email }}
                    </td>
                  }
                  <td class="px-4 py-3">
                    <span
                      class="font-mono text-xs tracking-wider text-primary/80 uppercase"
                    >
                      {{ row.tierName }}
                    </span>
                  </td>
                  <td
                    class="hidden px-4 py-3 font-mono text-xs text-muted-foreground sm:table-cell"
                  >
                    {{ row.purchaseDate | date: 'MMM d' }}
                  </td>
                  <td class="px-4 py-3">
                    @if (
                      row.status === 'valid' || row.status === 'checked_in'
                    ) {
                      <span
                        class="font-mono text-xs tracking-wider text-foreground uppercase"
                        data-testid="row-status"
                        >ACTIVE</span
                      >
                    } @else if (row.status === 'refunded') {
                      <span
                        class="font-mono text-xs tracking-wider text-muted-foreground uppercase"
                        data-testid="row-status"
                        >REFUNDED</span
                      >
                    } @else {
                      <span
                        class="font-mono text-xs tracking-wider text-muted-foreground uppercase"
                        data-testid="row-status"
                        >CANCELLED</span
                      >
                    }
                  </td>
                  <td class="px-4 py-3">
                    @if (row.checkedInAt) {
                      <span
                        class="font-mono text-xs text-foreground tabular-nums"
                        data-testid="row-checkin-time"
                        >{{ formatTimestamp(row.checkedInAt) }}</span
                      >
                    } @else {
                      <span
                        class="font-mono text-xs text-muted-foreground"
                        data-testid="row-checkin-time"
                        >—</span
                      >
                    }
                  </td>
                  <td
                    class="hidden px-4 py-3 text-xs text-muted-foreground md:table-cell"
                  >
                    {{ row.checkedInByName ?? '—' }}
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <!-- Load more -->
      @if (!isDone() && !isLoadingFirstPage()) {
        <div class="flex justify-center pt-2">
          <button
            type="button"
            z-button
            zType="outline"
            [zDisabled]="isLoadingMore()"
            (click)="loadMore()"
            data-testid="load-more-button"
            aria-label="Load more attendees"
          >
            @if (isLoadingMore()) {
              Loading...
            } @else {
              Load more
            }
          </button>
        </div>
      }
    </div>
  `,
})
export class AttendeeRosterTableComponent {
  readonly eventId = input.required<Id<'events'>>();
  /** Whether to show the export button. False for door staff. */
  readonly canExport = input<boolean>(false);

  private readonly convex = injectConvex();
  private readonly browser = inject(BrowserPlatformService);

  readonly searchQuery = signal('');
  private readonly trimmedSearchQuery = computed(() =>
    this.searchQuery().trim(),
  );
  readonly showRefunded = signal(false);
  readonly isExporting = signal(false);

  readonly skeletonRows = [1, 2, 3];

  private readonly rosterQuery = injectPaginatedQuery(
    api.events.analytics.getEventAttendeeRosterPage,
    () => {
      if (this.trimmedSearchQuery()) return skipToken;
      return {
        eventId: this.eventId(),
        includeRefunded: this.showRefunded(),
      };
    },
    {initialNumItems: 50},
  );

  private readonly searchResultsQuery = injectPaginatedQuery(
    api.events.analytics.searchEventAttendeesPage,
    () => {
      const q = this.trimmedSearchQuery();
      if (!q) return skipToken;
      return {
        eventId: this.eventId(),
        query: q,
        includeRefunded: this.showRefunded(),
      };
    },
    {initialNumItems: 50},
  );

  private readonly activeQuery = computed(() =>
    this.trimmedSearchQuery() ? this.searchResultsQuery : this.rosterQuery,
  );

  readonly rows = computed(
    (): RosterRow[] => this.activeQuery().results() ?? [],
  );

  readonly isDone = computed(() => this.activeQuery().isExhausted());
  readonly isLoadingFirstPage = computed(() =>
    this.activeQuery().isLoadingFirstPage(),
  );
  readonly isLoadingMore = computed(() => this.activeQuery().isLoadingMore());

  /**
   * Show the email column only when at least one row has a non-null email.
   * Door staff callers get all-null emails from the backend — that hides the column.
   */
  readonly showEmailColumn = computed(() => {
    const r = this.rows();
    if (r.length === 0) return false;
    return r.some((row) => row.email !== null);
  });

  readonly formatTimestamp = formatTimestampFull;

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  onToggleRefunded(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.showRefunded.set(checked);
  }

  loadMore(): void {
    const q = this.activeQuery();
    if (q.isLoadingMore() || q.isExhausted()) return;
    q.loadMore(50);
  }

  async exportCsv(): Promise<void> {
    if (this.isExporting()) return;
    this.isExporting.set(true);

    try {
      const result = await this.convex.action(
        api.events.analytics_export.exportEventRosterCsv,
        {
          eventId: this.eventId(),
          includeRefunded: this.showRefunded(),
        },
      );

      const blob = new Blob([result.csv], {type: 'text/csv;charset=utf-8;'});
      this.browser.downloadBlob(blob, result.filename);
    } catch (err: unknown) {
      if (err instanceof ConvexError) {
        const data = err.data as Record<string, unknown>;
        if (data['code'] === 'EXPORT_TOO_LARGE') {
          toast.error(
            'roster too large to export — contact support for a chunked export',
          );
        } else if (data['code'] === 'RATE_LIMITED') {
          toast.error(
            "slow down — you've hit the export limit, try again in an hour",
          );
        } else if (data['code'] === 'FORBIDDEN') {
          toast.error("you don't have permission to export this roster");
        } else {
          toast.error('something went wrong exporting — try again?');
        }
      } else {
        toast.error('something went wrong exporting — try again?');
      }
      logger.error('[AttendeeRosterTable] Export failed', err);
    } finally {
      this.isExporting.set(false);
    }
  }

  constructor() {
    effect(() => {
      const err = this.rosterQuery.error();
      if (err) {
        logger.error('[AttendeeRosterTable] Failed to load roster', err);
      }
    });

    effect(() => {
      const err = this.searchResultsQuery.error();
      if (err) {
        logger.error('[AttendeeRosterTable] Failed to search roster', err);
      }
    });
  }
}
