import {DatePipe} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  resource,
  signal,
} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {toast} from 'ngx-sonner';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {extractConvexErrorMessage} from '@/core/utils/error-message.utils';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';
import {readInputValue} from '@ui/utils/dom-event';

interface MarketingScheduleState {
  date: Date;
  time: string;
}

function formatLocalDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalTimeInput(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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

function getScheduleStateForTimestamp(
  timestamp: number,
): MarketingScheduleState {
  const scheduleDate = new Date(timestamp);
  return {
    date: new Date(
      scheduleDate.getFullYear(),
      scheduleDate.getMonth(),
      scheduleDate.getDate(),
    ),
    time: formatLocalTimeInput(scheduleDate),
  };
}

function getDefaultScheduleState(): MarketingScheduleState {
  const nextSlot = new Date(Date.now() + 15 * 60_000);
  nextSlot.setSeconds(0, 0);
  nextSlot.setMinutes(Math.ceil(nextSlot.getMinutes() / 5) * 5);
  return getScheduleStateForTimestamp(nextSlot.getTime());
}

function humanizeMarketingError(
  message: string | null,
  fallback: string,
): string {
  if (!message) return fallback;

  const knownMessages: Record<string, string> = {
    already_sent: 'This marketing announcement has already been sent.',
    not_scheduled: 'This marketing announcement is no longer scheduled.',
    record_not_found: 'Marketing announcement not found.',
    scheduled_too_far: 'Choose a send time within the next 90 days.',
    scheduled_too_soon: 'Choose a send time at least 1 minute from now.',
  };

  return knownMessages[message] ?? fallback;
}

@Component({
  selector: 'app-marketing-announcement-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {class: 'block'},
  imports: [
    DatePipe,
    ZardButtonComponent,
    ZardCardComponent,
    ZardIconComponent,
  ],
  template: `
    <z-card
      class="border-border bg-card/80 py-0 [&>[data-slot=card-content]]:p-6"
      data-testid="marketing-announcement-card"
    >
      <div class="space-y-4">
        <div>
          <p class="mono-label text-xs text-muted-foreground">
            Marketing Announcement
          </p>
          <p class="font-mono text-xs text-muted-foreground">
            Notify vetted, opted-in community members about this event.
          </p>
        </div>

        @if (statusError()) {
          <p
            class="font-mono text-xs text-destructive"
            data-testid="marketing-announcement-error"
            role="alert"
          >
            {{ statusError() }}
          </p>
        } @else if (isLoadingAnnouncementStatus()) {
          <p
            class="font-mono text-xs text-muted-foreground"
            data-testid="marketing-announcement-loading"
          >
            Loading announcement status...
          </p>
        } @else if (announcementStatus(); as status) {
          <div
            class="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-4"
            data-testid="marketing-announcement-status-card"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <z-icon
                  [zType]="
                    status.status === 'sent'
                      ? 'badge-check'
                      : status.status === 'scheduled'
                        ? 'clock'
                        : 'circle-x'
                  "
                  class="h-4 w-4"
                />
                <p
                  class="text-sm font-medium text-foreground"
                  data-testid="marketing-announcement-status"
                >
                  {{
                    status.status === 'scheduled'
                      ? 'Scheduled'
                      : status.status === 'sent'
                        ? 'Sent'
                        : 'Cancelled'
                  }}
                </p>
              </div>
              <span
                class="font-mono text-2xs tracking-widest uppercase"
                [class.text-success]="status.status === 'sent'"
                [class.text-primary]="status.status === 'scheduled'"
                [class.text-muted-foreground]="status.status === 'cancelled'"
              >
                {{ status.status }}
              </span>
            </div>

            @if (status.status === 'scheduled') {
              <p
                class="font-mono text-xs text-muted-foreground"
                data-testid="marketing-announcement-scheduled-for"
              >
                Sends {{ status.scheduledFor | date: 'medium' }}
              </p>
            }

            @if (status.status === 'sent') {
              <p
                class="font-mono text-xs text-muted-foreground"
                data-testid="marketing-announcement-sent-at"
              >
                Sent {{ status.sentAt ?? status.scheduledFor | date: 'medium' }}
                @if (status.recipientCount !== undefined) {
                  to {{ status.recipientCount }} recipient{{
                    status.recipientCount === 1 ? '' : 's'
                  }}
                }
              </p>
              <div
                class="grid gap-2 font-mono text-2xs text-muted-foreground sm:grid-cols-2"
                data-testid="marketing-announcement-tracking"
              >
                <p>
                  Opens {{ status.uniqueOpenCount }}
                  @if (status.recipientCount !== undefined) {
                    / {{ status.recipientCount }}
                  }
                  · {{ status.totalOpenCount }} total
                </p>
                <p>
                  Clicks {{ status.uniqueClickCount }}
                  @if (status.recipientCount !== undefined) {
                    / {{ status.recipientCount }}
                  }
                  · {{ status.totalClickCount }} total
                </p>
              </div>
              <p
                class="text-2xs text-muted-foreground/80"
                data-testid="marketing-announcement-tracking-disclaimer"
              >
                Open and click metrics are directional. Link scanners and
                privacy proxies can inflate them.
              </p>
            }

            @if (status.status === 'cancelled') {
              <p
                class="font-mono text-xs text-muted-foreground"
                data-testid="marketing-announcement-cancelled"
              >
                The last scheduled announcement was cancelled.
              </p>
            }
          </div>
        } @else {
          <p
            class="font-mono text-xs text-muted-foreground"
            data-testid="marketing-announcement-empty"
          >
            No marketing announcement is scheduled yet.
          </p>
        }

        @if (hasTrustLinks()) {
          <fieldset class="space-y-2" data-testid="audience-scope-fieldset">
            <legend class="text-plum-200 text-sm font-medium">Send to</legend>
            <label
              class="text-plum-300 flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="audienceScope"
                value="community"
                [checked]="audienceScope() === 'community'"
                (change)="audienceScope.set('community')"
                class="accent-amber-500"
              />
              My community
            </label>
            <label
              class="text-plum-300 flex cursor-pointer items-center gap-2 text-sm"
            >
              <input
                type="radio"
                name="audienceScope"
                value="community_and_trusted"
                [checked]="audienceScope() === 'community_and_trusted'"
                (change)="audienceScope.set('community_and_trusted')"
                class="accent-amber-500"
              />
              My community + trusted communities
            </label>
          </fieldset>
        }

        @if (recipientCountError()) {
          <p
            class="font-mono text-xs text-destructive"
            data-testid="marketing-recipient-error"
            role="alert"
          >
            {{ recipientCountError() }}
          </p>
        } @else if (isLoadingRecipientCount()) {
          <p
            class="font-mono text-xs text-muted-foreground"
            data-testid="marketing-recipient-loading"
          >
            Counting opted-in members...
          </p>
        } @else if (recipientCountState(); as audience) {
          <p
            class="font-mono text-xs text-muted-foreground"
            data-testid="marketing-recipient-count"
          >
            {{ audience.count }} opted-in member{{
              audience.count === 1 ? '' : 's'
            }}
            will receive this.
          </p>
          @if (
            audienceScope() === 'community_and_trusted' &&
            audience.trustLinkedCount
          ) {
            <p
              class="text-plum-400 text-xs"
              data-testid="marketing-recipient-breakdown"
            >
              {{ audience.directCount }} from your community +
              {{ audience.trustLinkedCount }} via trusted communities
            </p>
          }
        }

        @if (canManageAnnouncement()) {
          <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <input
              type="date"
              [value]="scheduledDateIso()"
              (change)="onScheduledDateChange($event)"
              class="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="marketing-schedule-date"
            />
            <input
              type="time"
              [value]="scheduledTime()"
              (input)="onScheduledTimeChange($event)"
              class="w-full rounded-md border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              data-testid="marketing-schedule-time"
            />
            <button
              z-button
              zType="outline"
              zSize="sm"
              type="button"
              (click)="scheduleForLater()"
              [zDisabled]="isScheduleDisabled()"
              data-testid="marketing-schedule-submit"
              class="w-full border-primary/50 text-primary hover:bg-primary/10 md:w-auto"
            >
              {{ isScheduled() ? 'Reschedule' : 'Schedule' }}
            </button>
          </div>

          <div class="flex flex-wrap gap-3">
            <button
              z-button
              zType="outline"
              zSize="sm"
              type="button"
              (click)="queueNow()"
              [zDisabled]="isQueueNowDisabled()"
              data-testid="marketing-queue-now"
              class="border-primary/50 text-primary hover:bg-primary/10"
            >
              <z-icon zType="send" class="mr-2 h-4 w-4" />
              {{ isScheduled() ? 'Queue instead' : 'Queue now' }}
            </button>

            @if (isScheduled()) {
              <button
                z-button
                zType="ghost"
                zSize="sm"
                type="button"
                (click)="cancelScheduledAnnouncement()"
                [zDisabled]="isActionLoading()"
                data-testid="marketing-cancel-scheduled"
                class="text-destructive hover:text-destructive"
              >
                Cancel scheduled send
              </button>
            }
          </div>

          <p class="font-mono text-2xs text-muted-foreground">
            Timezone: {{ userTimezone }}
          </p>
        }
      </div>
    </z-card>
  `,
})
export class MarketingAnnouncementCardComponent {
  private readonly convex = injectConvex();

  readonly eventId = input.required<string>();
  readonly organizerId = input<string | null>(null);
  readonly reloadToken = input(0);
  readonly dataChanged = output<void>();

  private readonly localReloadToken = signal(0);

  readonly userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  private readonly defaultScheduleState = getDefaultScheduleState();
  readonly scheduledDate = signal<Date | null>(this.defaultScheduleState.date);
  readonly scheduledTime = signal(this.defaultScheduleState.time);
  readonly audienceScope = signal<'community' | 'community_and_trusted'>(
    'community',
  );
  readonly isActionLoading = signal(false);
  private readonly lastSyncedScheduleKey = signal<string | null>(null);

  readonly scheduledDateIso = computed(() => {
    const current = this.scheduledDate();
    return current ? formatLocalDateInput(current) : '';
  });

  readonly recipientCountResource = resource({
    params: () => ({
      eventId: this.eventId() || null,
      parentReloadToken: this.reloadToken(),
      localReloadToken: this.localReloadToken(),
      audienceScope: this.audienceScope(),
    }),
    loader: ({params}) => {
      if (!params.eventId) return Promise.resolve(null);
      return this.convex.query(api.marketing.emails.getRecipientCount, {
        eventId: params.eventId as Id<'events'>,
        audienceScope: params.audienceScope,
      });
    },
  });

  readonly trustLinksResource = resource({
    params: () => ({
      organizerId: this.organizerId() || null,
      parentReloadToken: this.reloadToken(),
      localReloadToken: this.localReloadToken(),
    }),
    loader: ({params}) => {
      if (!params.organizerId) return Promise.resolve(null);
      return this.convex.query(api.communities.trust_links.list, {
        organizerId: params.organizerId as Id<'organizers'>,
        direction: 'outgoing',
      });
    },
  });

  readonly announcementStatusResource = resource({
    params: () => ({
      eventId: this.eventId() || null,
      parentReloadToken: this.reloadToken(),
      localReloadToken: this.localReloadToken(),
    }),
    loader: ({params}) => {
      if (!params.eventId) return Promise.resolve(null);
      return this.convex.query(api.marketing.emails.getAnnouncementStatus, {
        eventId: params.eventId as Id<'events'>,
      });
    },
  });

  readonly recipientCountState = computed(
    () => safeResourceValue(this.recipientCountResource) ?? null,
  );
  readonly announcementStatus = computed(
    () => safeResourceValue(this.announcementStatusResource) ?? null,
  );
  readonly isLoadingRecipientCount = this.recipientCountResource.isLoading;
  readonly isLoadingAnnouncementStatus =
    this.announcementStatusResource.isLoading;

  readonly hasTrustLinks = computed(() => {
    const links = safeResourceValue(this.trustLinksResource);
    return (links?.length ?? 0) > 0;
  });

  readonly recipientCountError = computed(() => {
    const error = this.recipientCountResource.error();
    if (!error) return null;
    return error instanceof Error && error.message
      ? `couldn't load marketing audience — ${error.message}`
      : "couldn't load marketing audience";
  });

  readonly statusError = computed(() => {
    const error = this.announcementStatusResource.error();
    if (!error) return null;
    return error instanceof Error && error.message
      ? `couldn't load announcement status — ${error.message}`
      : "couldn't load announcement status";
  });

  readonly hasResolvedAnnouncementStatus = computed(
    () => !this.isLoadingAnnouncementStatus() && this.statusError() === null,
  );
  readonly isScheduled = computed(
    () => this.announcementStatus()?.status === 'scheduled',
  );
  readonly canManageAnnouncement = computed(
    () =>
      this.hasResolvedAnnouncementStatus() &&
      this.announcementStatus()?.status !== 'sent',
  );

  readonly isScheduleDisabled = computed(() => {
    const audience = this.recipientCountState();
    return (
      this.isActionLoading() ||
      !this.scheduledDate() ||
      !this.scheduledTime() ||
      !audience ||
      audience.cappedAt500 ||
      audience.count === 0
    );
  });

  readonly isQueueNowDisabled = computed(() => {
    const audience = this.recipientCountState();
    return (
      this.isActionLoading() ||
      !audience ||
      audience.cappedAt500 ||
      audience.count === 0
    );
  });

  constructor() {
    effect(() => {
      if (!this.hasResolvedAnnouncementStatus()) return;

      const status = this.announcementStatus();
      const nextSyncKey = status
        ? `${status._id}:${status.status}:${status.scheduledFor}`
        : 'none';
      if (nextSyncKey === this.lastSyncedScheduleKey()) return;

      if (status?.status === 'scheduled') {
        const scheduleState = getScheduleStateForTimestamp(status.scheduledFor);
        this.scheduledDate.set(scheduleState.date);
        this.scheduledTime.set(scheduleState.time);
      } else {
        this.resetScheduleState();
      }

      this.lastSyncedScheduleKey.set(nextSyncKey);
    });
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

  async queueNow(): Promise<void> {
    const eventId = this.eventId();
    if (!eventId || !this.canManageAnnouncement() || this.isQueueNowDisabled())
      return;

    await this.scheduleAnnouncement(
      Date.now() + 61_000,
      this.isScheduled()
        ? 'Marketing announcement moved to the queue.'
        : 'Marketing announcement queued.',
    );
  }

  async scheduleForLater(): Promise<void> {
    const eventId = this.eventId();
    const scheduledFor = this.buildScheduledForMs();
    if (
      !eventId ||
      !this.canManageAnnouncement() ||
      this.isScheduleDisabled() ||
      scheduledFor === null
    )
      return;

    await this.scheduleAnnouncement(
      scheduledFor,
      this.isScheduled()
        ? 'Marketing announcement rescheduled.'
        : 'Marketing announcement scheduled.',
    );
  }

  async cancelScheduledAnnouncement(): Promise<void> {
    const status = this.announcementStatus();
    if (!status || status.status !== 'scheduled' || this.isActionLoading())
      return;

    this.isActionLoading.set(true);
    try {
      await this.convex.mutation(api.marketing.emails.cancelAnnouncement, {
        eventMarketingEmailId: status._id,
      });
      toast.success('Scheduled marketing announcement cancelled.');
      this.refreshData();
    } catch (error) {
      logger.error('Failed to cancel marketing announcement', error);
      toast.error(
        humanizeMarketingError(
          extractConvexErrorMessage(error),
          'Failed to cancel the scheduled marketing announcement.',
        ),
      );
    } finally {
      this.isActionLoading.set(false);
    }
  }

  buildScheduledForMs(): number | null {
    const date = this.scheduledDate();
    const time = this.scheduledTime();
    if (!date || !time) return null;

    const [hoursRaw, minutesRaw] = time.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;

    const scheduledFor = new Date(date);
    scheduledFor.setHours(hours, minutes, 0, 0);
    return scheduledFor.getTime();
  }

  private resetScheduleState(): void {
    const defaultScheduleState = getDefaultScheduleState();
    this.scheduledDate.set(defaultScheduleState.date);
    this.scheduledTime.set(defaultScheduleState.time);
  }

  private async scheduleAnnouncement(
    scheduledFor: number,
    successMessage: string,
  ): Promise<void> {
    const eventId = this.eventId();
    if (!eventId || this.isActionLoading()) return;

    if (this.audienceScope() === 'community_and_trusted') {
      const count = this.recipientCountState();
      if (count && count.totalCount >= 50 && count.trustLinkedCount > 0) {
        const confirmed = confirm(
          `This will send to ~${count.totalCount} people (${count.directCount} from your community + ${count.trustLinkedCount} via trusted communities). Continue?`,
        );
        if (!confirmed) return;
      }
    }

    this.isActionLoading.set(true);
    try {
      await this.convex.mutation(api.marketing.emails.scheduleAnnouncement, {
        eventId: eventId as Id<'events'>,
        scheduledFor,
        audienceScope: this.audienceScope(),
      });
      toast.success(successMessage);
      this.refreshData();
    } catch (error) {
      logger.error('Failed to schedule marketing announcement', error);
      toast.error(
        humanizeMarketingError(
          extractConvexErrorMessage(error),
          'Failed to schedule the marketing announcement.',
        ),
      );
    } finally {
      this.isActionLoading.set(false);
    }
  }

  private refreshData(): void {
    this.localReloadToken.update((count) => count + 1);
    this.dataChanged.emit();
  }
}
