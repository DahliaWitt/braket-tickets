import {DatePipe} from '@angular/common';
import {
  Component,
  inject,
  computed,
  input,
  ChangeDetectionStrategy,
} from '@angular/core';
import {Router} from '@angular/router';
import {EventsService} from '@/features/admin/services/events.service';
import {injectQuery} from 'convex-angular';
import {type AdminEventListItem} from '@/core/models/event.types';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';
import {toast} from 'ngx-sonner';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {logger} from '@/utils/logger';
import {compareEventDatesDescending} from '@/features/admin/utils/event-date.utils';

type RouteQueryParams = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;

@Component({
  selector: 'app-admin-events-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ZardButtonComponent,
    ZardCardComponent,
    EmptyStateComponent,
    ZardSkeletonComponent,
  ],
  template: `
    <div class="mb-4">
      <button
        type="button"
        z-button
        zType="default"
        (click)="openCreateEventDialog()"
        data-testid="create-event"
        class="border-none bg-primary shadow-[0_0_15px_-3px_hsl(var(--primary)/0.4)] hover:bg-primary/90"
      >
        Create Event
      </button>
    </div>

    <!-- Desktop Table View -->
    <div
      class="hidden overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl md:block"
    >
      <table class="w-full border-collapse text-left">
        <thead class="mono-label bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" class="border-b border-border p-5 font-medium">
              Title
            </th>
            <th scope="col" class="border-b border-border p-5 font-medium">
              Status
            </th>
            <th scope="col" class="border-b border-border p-5 font-medium">
              Date
            </th>
            <th scope="col" class="border-b border-border p-5 font-medium">
              Location
            </th>
            <th scope="col" class="w-48 border-b border-border p-5 font-medium">
              Actions
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border/50">
          @if (isLoading()) {
            @for (i of [1, 2, 3, 4, 5]; track i) {
              <tr class="animate-pulse">
                <td class="p-5">
                  <z-skeleton class="h-6 w-48 rounded bg-muted/50" />
                </td>
                <td class="p-5">
                  <z-skeleton class="h-5 w-16 rounded bg-muted/50" />
                </td>
                <td class="p-5">
                  <z-skeleton class="h-4 w-24 rounded bg-muted/50" />
                </td>
                <td class="p-5">
                  <z-skeleton class="h-4 w-32 rounded bg-muted/50" />
                </td>
                <td class="p-5">
                  <z-skeleton class="h-8 w-full rounded bg-muted/50" />
                </td>
              </tr>
            }
          } @else {
            @for (event of events(); track event._id; let i = $index) {
              <tr
                [class]="
                  'group animate-in fade-in slide-in-from-bottom-2 transition-colors duration-300 hover:bg-muted/30 ' +
                  (i === 0
                    ? 'delay-75'
                    : i === 1
                      ? 'delay-150'
                      : i === 2
                        ? 'delay-225'
                        : 'delay-300')
                "
                role="row"
                data-testid="event-entry"
              >
                <td class="p-5 align-top">
                  <div
                    class="font-display text-lg font-bold tracking-wide text-foreground"
                  >
                    {{ event.title }}
                  </div>
                  @if (event.description) {
                    <div
                      class="mt-1 line-clamp-2 font-sans text-sm text-muted-foreground"
                    >
                      {{ event.description }}
                    </div>
                  }
                </td>
                <td class="p-5 align-top">
                  <span
                    [class]="
                      'inline-flex items-center rounded border px-2 py-1 font-mono text-xs tracking-widest uppercase ' +
                      getStatusClasses(event.status)
                    "
                    data-testid="event-status"
                  >
                    {{ event.status || 'DRAFT' }}
                  </span>
                </td>
                <td class="p-5 align-top">
                  <div class="font-mono text-sm text-foreground/80">
                    @if (event.date) {
                      {{ event.date | date: 'mediumDate' }},
                      {{ event.date | date: 'shortTime' }}
                    } @else {
                      -
                    }
                  </div>
                </td>
                <td class="p-5 align-top">
                  <div class="font-mono text-sm text-foreground/80">
                    {{ event.location || '-' }}
                  </div>
                </td>
                <td class="p-5 align-top">
                  <div class="flex flex-col gap-2">
                    <a
                      z-button
                      zType="outline"
                      [zFull]="true"
                      data-testid="manage-event"
                      [href]="eventRouteHref(event, 'manage')"
                      (click)="navigateToEvent($event, event, 'manage')"
                    >
                      MANAGE
                    </a>
                    <a
                      z-button
                      zType="default"
                      [zFull]="true"
                      data-testid="edit-event"
                      [href]="eventRouteHref(event, 'edit')"
                      (click)="navigateToEvent($event, event, 'edit')"
                      class="border-none bg-info hover:bg-info/90"
                    >
                      EDIT
                    </a>
                    <button
                      type="button"
                      z-button
                      zType="destructive"
                      [zFull]="true"
                      data-testid="delete-event"
                      [attr.aria-label]="deleteEventLabel(event)"
                      (click)="deleteEvent(event)"
                    >
                      DELETE
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="p-0">
                  <app-empty-state title="NO EVENTS FOUND" />
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>

    <!-- Mobile Card View -->
    <div class="space-y-4 md:hidden">
      @if (isLoading()) {
        @for (i of [1, 2, 3]; track i) {
          <z-skeleton class="h-48 w-full rounded-xl bg-card/80" />
        }
      } @else {
        @for (event of events(); track event._id; let i = $index) {
          <z-card
            [class]="
              'animate-in fade-in slide-in-from-bottom-8 border-border bg-card/80 transition-transform duration-300 motion-safe:hover:scale-[1.01] ' +
              (i === 0
                ? 'delay-75'
                : i === 1
                  ? 'delay-150'
                  : i === 2
                    ? 'delay-225'
                    : 'delay-300')
            "
            [zTitle]="eventHeader"
            role="article"
            data-testid="event-entry"
          >
            <ng-template #eventHeader>
              <div class="flex min-w-0 items-start justify-between">
                <div class="min-w-0">
                  <div
                    class="flex min-w-0 items-center gap-2 font-display text-lg font-bold tracking-wide text-foreground"
                  >
                    <span class="truncate">{{ event.title }}</span>
                    <span
                      [class]="
                        'inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 font-mono text-2xs tracking-widest uppercase ' +
                        getStatusClasses(event.status)
                      "
                    >
                      {{ event.status || 'DRAFT' }}
                    </span>
                  </div>
                  <div class="mt-1 font-mono text-xs text-muted-foreground">
                    @if (event.date) {
                      {{ event.date | date: 'mediumDate' }},
                      {{ event.date | date: 'shortTime' }}
                    }
                  </div>
                </div>
              </div>
            </ng-template>

            <div class="space-y-4">
              <div
                class="grid grid-cols-1 gap-2 border-t border-b border-border/50 py-3 text-sm"
              >
                <div>
                  <div
                    class="mb-1 font-mono text-2xs text-muted-foreground uppercase"
                  >
                    Location
                  </div>
                  <div class="font-mono text-xs text-foreground/80">
                    {{ event.location || '-' }}
                  </div>
                </div>
                @if (event.description) {
                  <div>
                    <div
                      class="mb-1 font-mono text-2xs text-muted-foreground uppercase"
                    >
                      Description
                    </div>
                    <div class="font-sans text-sm text-foreground/80">
                      {{ event.description }}
                    </div>
                  </div>
                }
              </div>
            </div>

            <div card-footer class="flex w-full gap-3 pt-0">
              <a
                z-button
                zType="outline"
                class="flex-1"
                data-testid="manage-event"
                [href]="eventRouteHref(event, 'manage')"
                (click)="navigateToEvent($event, event, 'manage')"
              >
                MANAGE
              </a>
              <a
                z-button
                zType="default"
                class="flex-1 border-none bg-info hover:bg-info/90"
                data-testid="edit-event"
                [href]="eventRouteHref(event, 'edit')"
                (click)="navigateToEvent($event, event, 'edit')"
              >
                EDIT
              </a>
              <button
                type="button"
                z-button
                zType="destructive"
                class="flex-1"
                data-testid="delete-event"
                [attr.aria-label]="deleteEventLabel(event)"
                (click)="deleteEvent(event)"
              >
                DELETE
              </button>
            </div>
          </z-card>
        } @empty {
          <app-empty-state title="NO EVENTS FOUND" />
        }
      }
    </div>
  `,
})
export class AdminEventsTableComponent {
  readonly routePrefix = input<string>('/admin');
  readonly routeQueryParams = input<RouteQueryParams | null>(null);
  readonly organizerId = input<Id<'organizers'> | undefined>(undefined);

  private eventsService = inject(EventsService);
  private alertDialog = inject(BraAlertDialogService);
  private router = inject(Router);

  /** Helper method for status badge styling */
  protected getStatusClasses(status: string | undefined): string {
    const statusMap: Record<string, string> = {
      published: 'bg-success/10 text-success border-success/20',
      draft: 'bg-warning/10 text-warning border-warning/20',
      cancelled: 'bg-destructive/10 text-destructive border-destructive/20',
    };
    return statusMap[status ?? 'draft'] ?? statusMap['draft'];
  }

  private readonly eventsQuery = injectQuery(
    api.events.management.adminList,
    () => {
      const organizerId = this.organizerId();
      return organizerId ? {organizerId} : {};
    },
    {
      onError: (error) => {
        logger.error('Failed to load events', error);
        toast.error('Failed to load events');
      },
    },
  );

  readonly events = computed(() =>
    (this.eventsQuery.data() ?? []).sort(
      (a: AdminEventListItem, b: AdminEventListItem) =>
        compareEventDatesDescending(a.date, b.date),
    ),
  );
  isLoading = this.eventsQuery.isLoading;

  openCreateEventDialog() {
    void this.router.navigate([this.routePrefix(), 'events', 'new']);
  }

  editEvent(event: AdminEventListItem) {
    this.navigateEvent(event, 'edit');
  }

  manageEvent(event: AdminEventListItem) {
    this.navigateEvent(event, 'manage');
  }

  navigateToEvent(
    clickEvent: MouseEvent,
    event: AdminEventListItem,
    action: 'edit' | 'manage',
  ): void {
    if (this.shouldUseNativeLinkBehavior(clickEvent)) {
      return;
    }

    clickEvent.preventDefault();
    if (action === 'edit') {
      this.editEvent(event);
      return;
    }
    this.manageEvent(event);
  }

  protected eventRouteHref(
    event: AdminEventListItem,
    action: 'edit' | 'manage',
  ): string {
    const rawPrefix = this.routePrefix();
    const prefix = rawPrefix.startsWith('/') ? rawPrefix : `/${rawPrefix}`;
    const path = `${prefix.replace(/\/+$/, '')}/events/${encodeURIComponent(event._id)}/${action}`;
    const queryParams = this.eventRouteQueryParams();

    if (!queryParams) {
      return path;
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(queryParams)) {
      searchParams.set(key, String(value));
    }
    return `${path}?${searchParams.toString()}`;
  }

  private navigateEvent(
    event: AdminEventListItem,
    action: 'edit' | 'manage',
  ): void {
    const commands = [this.routePrefix(), 'events', event._id, action];
    const queryParams = this.eventRouteQueryParams();
    if (queryParams) {
      void this.router.navigate(commands, {queryParams});
      return;
    }
    void this.router.navigate(commands);
  }

  private shouldUseNativeLinkBehavior(event: MouseEvent): boolean {
    return (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    );
  }

  private eventRouteQueryParams():
    | Record<string, string | number | boolean>
    | undefined {
    const params = this.routeQueryParams();
    if (!params) {
      return undefined;
    }

    const normalized: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value != null) {
        normalized[key] = value;
      }
    }

    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }

  deleteEvent(event: AdminEventListItem) {
    const deleteBlockMessage = this.getDeleteBlockMessage(event);
    if (deleteBlockMessage) {
      this.alertDialog.info({
        zTitle: 'Cannot Delete Event',
        zDescription: deleteBlockMessage,
        zOkText: 'Close',
      });
      return;
    }

    this.alertDialog.confirm({
      zTitle: 'Delete Event',
      zDescription: `Are you sure you want to delete "${event.title}"? This action cannot be undone.`,
      zOkText: 'Delete Event',
      zOkDestructive: true,
      zCancelText: 'Cancel',
      zOnOk: () => {
        void this.performDelete(event);
      },
    });
  }

  private async performDelete(event: AdminEventListItem) {
    try {
      await this.eventsService.delete(event._id);
      toast.success('Event deleted');
      this.eventsQuery.refetch();
    } catch (e) {
      logger.error('Operation failed', e);
      toast.error('Failed to delete event');
    }
  }

  private getSoldTicketLabel(soldCount: number): string {
    return `${soldCount} sold ${soldCount === 1 ? 'ticket' : 'tickets'}`;
  }

  private getDeleteBlockMessage(event: AdminEventListItem): string | null {
    if ((event.soldCount ?? 0) > 0) {
      return `"${event.title}" has ${this.getSoldTicketLabel(event.soldCount ?? 0)}. Events with sold tickets cannot be deleted because doing so would invalidate ticket holders' purchases and QR codes.`;
    }

    if (event.hasCompletedOrders) {
      return `"${event.title}" has completed orders. Events with completed purchases cannot be deleted because Braket Tickets must preserve purchase history and related records.`;
    }

    if (event.hasAnyTickets) {
      return `"${event.title}" has existing ticket records. Events with ticket history cannot be deleted because Braket Tickets must preserve ticket and attendee records.`;
    }

    return null;
  }

  deleteEventLabel(event: AdminEventListItem): string {
    return `Delete event ${event.title}, id ${this.idSuffix(event._id)}`;
  }

  private idSuffix(id: string): string {
    return (id.length <= 8 ? id : id.slice(-6)).toUpperCase();
  }
}
