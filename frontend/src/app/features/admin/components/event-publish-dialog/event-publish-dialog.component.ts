import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  input,
  output,
  model,
} from '@angular/core';
import {type Id} from '@convex/_generated/dataModel';
import {api} from '@convex/_generated/api';
import {injectQuery, skipToken} from 'convex-angular';
import {toast} from 'ngx-sonner';
import {readInputValue} from '@ui/utils/dom-event';

export type PublishedEvent =
  | {mode: 'skip'}
  | {mode: 'now'}
  | {mode: 'scheduled'; scheduledFor: number};

function formatLocalDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

@Component({
  selector: 'app-event-publish-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    @if (isOpen()) {
      <div
        class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        tabindex="0"
        (click)="closeFromBackdropClick($event)"
        (keydown.enter)="closeFromBackdropKey($event)"
        (keydown.space)="closeFromBackdropKey($event)"
        (keydown.escape)="isOpen.set(false)"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-dialog-title"
        data-testid="publish-dialog-overlay"
      >
        <div
          class="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-5"
          data-testid="publish-dialog"
        >
          <h2
            id="publish-dialog-title"
            class="font-display text-xl uppercase tracking-widest text-foreground"
          >
            Publish this event?
          </h2>

          <div class="border border-border rounded-lg p-4 space-y-3">
            <p class="text-xs mono-label text-muted-foreground">
              Send announcement email
            </p>

            <label
              class="flex items-center gap-3 cursor-pointer"
              data-testid="announcement-skip-label"
            >
              <input
                type="radio"
                name="announcement"
                value="skip"
                [checked]="announcementChoice() === 'skip'"
                (change)="announcementChoice.set('skip')"
                class="accent-primary"
              />
              <span class="text-sm text-foreground">Don't send</span>
            </label>

            <label
              class="flex items-center gap-3 cursor-pointer"
              data-testid="announcement-now-label"
            >
              <input
                type="radio"
                name="announcement"
                value="now"
                [checked]="announcementChoice() === 'now'"
                (change)="announcementChoice.set('now')"
                class="accent-primary"
              />
              <span class="text-sm text-foreground">Send now</span>
            </label>

            <label
              class="flex items-center gap-3 cursor-pointer"
              data-testid="announcement-scheduled-label"
            >
              <input
                type="radio"
                name="announcement"
                value="scheduled"
                [checked]="announcementChoice() === 'scheduled'"
                (change)="announcementChoice.set('scheduled')"
                class="accent-primary"
              />
              <span class="text-sm text-foreground">Schedule for later</span>
            </label>

            @if (announcementChoice() === 'scheduled') {
              <div class="pl-7 space-y-2">
                <input
                  type="date"
                  [value]="scheduledDateIso()"
                  (change)="onScheduledDateChange($event)"
                  class="border border-border rounded px-3 py-2 text-sm text-foreground w-full font-mono"
                  data-testid="schedule-date"
                />
                <input
                  type="time"
                  [value]="scheduledTime()"
                  (input)="onScheduledTimeChange($event)"
                  class="border border-border rounded px-3 py-2 text-sm text-foreground w-full font-mono"
                  data-testid="schedule-time"
                />
                <p class="text-xs text-muted-foreground font-mono">
                  Timezone: {{ userTimezone }}
                </p>
              </div>
            }
          </div>

          @if (announcementChoice() !== 'skip') {
            @if (recipientCount.isLoading()) {
              <p class="text-sm text-muted-foreground font-mono animate-pulse">
                Counting opted-in members...
              </p>
            } @else {
              <p
                class="text-sm text-muted-foreground font-mono"
                data-testid="recipient-count"
              >
                {{ recipientCount.data()?.count ?? 0 }} opted-in member{{
                  (recipientCount.data()?.count ?? 0) !== 1 ? 's' : ''
                }}
                will receive this.
              </p>
            }
          }

          <div class="flex gap-3 justify-end">
            <button
              type="button"
              (click)="isOpen.set(false)"
              data-testid="publish-dialog-cancel"
              class="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              (click)="confirmPublish()"
              data-testid="publish-dialog-confirm"
              class="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              Publish →
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class EventPublishDialogComponent {
  // ── Inputs ──────────────────────────────────────────────────────────
  readonly eventId = input<Id<'events'> | undefined>();
  readonly communityId = input.required<string>();
  readonly isOpen = model.required<boolean>();

  // ── Outputs ─────────────────────────────────────────────────────────
  published = output<PublishedEvent>();

  // ── Dialog state ────────────────────────────────────────────────────
  readonly announcementChoice = signal<'skip' | 'now' | 'scheduled'>('now');
  readonly scheduledDate = signal<Date | null>(null);
  readonly scheduledTime = signal<string>('12:00');

  readonly userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  /** ISO date string for the date input's [value] binding, or empty string if unset */
  readonly scheduledDateIso = computed(() => {
    const d = this.scheduledDate();
    return d ? formatLocalDateInput(d) : '';
  });

  // ── Convex ──────────────────────────────────────────────────────────
  readonly recipientCount = injectQuery(
    api.marketing.emails.getRecipientCount,
    () => {
      const eventId = this.eventId();
      if (eventId) {
        return {eventId};
      }

      const communityId = this.communityId();
      if (!communityId) return skipToken;
      return {
        organizerId: communityId as Id<'organizers'>,
      };
    },
  );

  // ── Methods ─────────────────────────────────────────────────────────

  closeFromBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.isOpen.set(false);
    }
  }

  closeFromBackdropKey(event: Event): void {
    if (event.target !== event.currentTarget) return;

    this.isOpen.set(false);
    event.preventDefault();
  }

  confirmPublish(): void {
    const choice = this.announcementChoice();
    if (choice === 'scheduled') {
      const scheduledFor = this.buildScheduledForMs();
      if (!scheduledFor) {
        toast.error('Choose a valid send time before publishing.');
        return;
      }

      this.isOpen.set(false);
      this.published.emit({mode: 'scheduled', scheduledFor});
      return;
    }

    this.isOpen.set(false);
    this.published.emit({mode: choice});
  }

  onScheduledDateChange(event: Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.scheduledDate.set(parseLocalDateInput(value));
  }

  onScheduledTimeChange(event: Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.scheduledTime.set(value);
  }

  buildScheduledForMs(): number | null {
    const date = this.scheduledDate();
    const time = this.scheduledTime();
    if (!date || !time) return null;
    const [hours, minutes] = time.split(':').map(Number);
    const d = new Date(date);
    d.setHours(hours, minutes, 0, 0);
    return d.getTime();
  }
}
