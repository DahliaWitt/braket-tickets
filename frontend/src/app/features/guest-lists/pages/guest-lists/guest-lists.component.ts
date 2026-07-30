import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import type {OnInit} from '@angular/core';
import {RouterLink} from '@angular/router';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {GuestListDelegateService} from '../../services/guest-list-delegate.service';
import {logger} from '@/utils/logger';
import {EventDatePipe} from '@/utils/event-date.pipe';
import {EventEndTimePipe} from '@/utils/event-end-time.pipe';

@Component({
  selector: 'app-guest-lists',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    EventDatePipe,
    EventEndTimePipe,
    RouterLink,
    ContentLayoutComponent,
  ],
  template: `
    <app-content-layout>
      <main class="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
        <p
          class="text-xs font-bold tracking-[0.24em] text-muted-foreground uppercase"
        >
          Door list / delegated access
        </p>
        <h1
          class="mt-3 font-display text-4xl font-extrabold tracking-tight uppercase sm:text-6xl"
        >
          Your guest lists
        </h1>
        <p
          class="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base"
        >
          Add the people you want at the door. Every guest receives their ticket
          by email.
        </p>

        @if (loading()) {
          <div
            data-testid="guest-lists-loading"
            class="mt-12 border-y border-border py-8 text-sm tracking-widest uppercase"
          >
            Loading assignments…
          </div>
        } @else if (loadFailure()) {
          <section
            data-testid="guest-lists-load-failure"
            class="mt-12 border-y border-border py-10"
          >
            <h2 class="font-display text-xl font-extrabold uppercase">
              We couldn’t load your guest lists
            </h2>
            <p class="mt-2 text-sm text-muted-foreground">
              Check your connection and try again.
            </p>
            <button
              data-testid="guest-lists-retry-loading"
              type="button"
              class="mt-6 text-sm font-bold tracking-widest uppercase underline underline-offset-4"
              (click)="retryLoading()"
            >
              Try again
            </button>
          </section>
        } @else {
          @if (assignments().length === 0) {
            <section
              data-testid="guest-lists-empty"
              class="mt-12 border-y border-border py-10"
            >
              <h2 class="font-display text-xl font-extrabold uppercase">
                No active guest lists
              </h2>
              <p class="mt-2 text-sm text-muted-foreground">
                Active artist and staff assignments will appear here until their
                event ends.
              </p>
            </section>
          } @else {
            <div class="mt-12 divide-y divide-border border-y border-border">
              @for (
                assignment of assignments();
                track assignment.assignmentId
              ) {
                <a
                  data-testid="guest-list-assignment-link"
                  [routerLink]="['/guest-lists', assignment.assignmentId]"
                  class="group grid gap-4 py-6 transition-colors hover:bg-muted/30 sm:grid-cols-[1fr_auto] sm:items-center sm:px-4"
                >
                  <div>
                    <p
                      class="text-xs font-bold tracking-[0.2em] text-muted-foreground uppercase"
                    >
                      {{ assignment.role }} ·
                      {{ assignment.eventDate | eventDate }} ·
                      {{ assignment.eventDate | eventDate: 'shortTime'
                      }}{{
                        assignment.eventEndDate
                          | eventEndTime: assignment.eventDate
                      }}
                    </p>
                    <h2
                      class="mt-2 font-display text-2xl font-extrabold tracking-tight uppercase"
                    >
                      {{ assignment.eventTitle }}
                    </h2>
                  </div>
                  <div class="flex items-center gap-5">
                    <span class="text-sm tabular-nums">
                      {{ assignment.usedSlots }} /
                      {{ assignment.grantedSlots }} used
                    </span>
                    <span
                      aria-hidden="true"
                      class="text-xl transition-transform group-hover:translate-x-1"
                      >→</span
                    >
                  </div>
                </a>
              }
            </div>
          }
          @if (!isDone()) {
            <button
              data-testid="guest-lists-load-more"
              type="button"
              class="mt-8 text-sm font-bold tracking-widest uppercase underline underline-offset-4 disabled:cursor-wait disabled:text-muted-foreground disabled:no-underline"
              [disabled]="loadingMore()"
              [attr.aria-busy]="loadingMore()"
              (click)="loadMore()"
            >
              {{ loadingMore() ? 'Loading more…' : 'Load more guest lists' }}
            </button>
          }
          @if (paginationFailure()) {
            <div
              data-testid="guest-lists-pagination-failure"
              role="alert"
              class="mt-6 flex flex-wrap items-center justify-between gap-3 border-y border-destructive/40 py-4 text-sm text-destructive-text"
            >
              <span>More guest lists couldn’t load — try again?</span>
              <button
                data-testid="guest-lists-retry-pagination"
                type="button"
                class="font-bold tracking-widest uppercase underline underline-offset-4 disabled:cursor-wait disabled:text-muted-foreground disabled:no-underline"
                [disabled]="loadingMore()"
                [attr.aria-busy]="loadingMore()"
                (click)="loadMore()"
              >
                Try again
              </button>
            </div>
          }
        }
      </main>
    </app-content-layout>
  `,
})
export class GuestListsComponent implements OnInit {
  private readonly delegate = inject(GuestListDelegateService);
  readonly loading = signal(true);
  readonly loadingMore = signal(false);
  readonly loadFailure = signal(false);
  readonly paginationFailure = signal(false);
  readonly isDone = signal(true);
  readonly assignments = signal<
    Awaited<ReturnType<GuestListDelegateService['listMine']>>['page']
  >([]);

  ngOnInit(): void {
    void this.loadAssignments();
  }

  private continueCursor: string | null = null;

  retryLoading(): void {
    this.loading.set(true);
    this.loadFailure.set(false);
    void this.loadAssignments();
  }

  async loadMore(): Promise<void> {
    if (this.loadingMore() || this.isDone()) return;
    this.loadingMore.set(true);
    this.paginationFailure.set(false);
    await this.loadAssignments(true);
  }

  private async loadAssignments(append = false): Promise<void> {
    try {
      const result = await this.delegate.listMine(
        append ? this.continueCursor : null,
      );
      this.assignments.update((current) =>
        append ? [...current, ...result.page] : result.page,
      );
      this.continueCursor = result.continueCursor;
      this.isDone.set(result.isDone);
      this.loadFailure.set(false);
      this.paginationFailure.set(false);
    } catch (error) {
      logger.error('Failed to load delegated guest-list assignments', error);
      if (append) {
        this.paginationFailure.set(true);
      } else {
        this.assignments.set([]);
        this.loadFailure.set(true);
      }
    } finally {
      this.loading.set(false);
      this.loadingMore.set(false);
    }
  }
}
