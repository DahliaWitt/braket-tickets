import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  type OnInit,
  effect,
} from '@angular/core';
import {RouterLink} from '@angular/router';
import {FormField, form} from '@angular/forms/signals';
import {AuthService} from '@/core/services/auth.service';
import {injectQueries, skipToken} from 'convex-angular';
import {toast} from 'ngx-sonner';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {api} from '@convex/_generated/api';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {CheckInScannerComponent} from '@/features/admin/components/check-in-scanner/check-in-scanner.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {CheckInService} from '@/features/admin/services/check-in.service';
import {readInputValue} from '@ui/utils/dom-event';
import {EventDatePipe} from '@/utils/event-date.pipe';

import {type Id} from '@convex/_generated/dataModel';
import {type FunctionReturnType} from 'convex/server';
type Ticket = FunctionReturnType<typeof api.tickets.public.listByEvent>[0];
type Guest = FunctionReturnType<typeof api.events.guests.listByEvent>[0];
type CheckInResult = FunctionReturnType<typeof api.events.check_in.checkIn>;

// Precompute lowercase search string to avoid repeated operations during filtering
type SearchableTicket = Ticket & {searchStr: string};
type SearchableGuest = Guest & {searchStr: string};
interface ManualFeedback {
  kind: 'success' | 'error';
  message: string;
}

@Component({
  selector: 'app-check-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CheckInService],
  imports: [
    EventDatePipe,
    RouterLink,
    FormField,
    ZardButtonComponent,
    ZardCardComponent,
    ZardSkeletonComponent,
    CheckInScannerComponent,
    ZardInputDirective,
  ],
  templateUrl: './check-in.component.html',
})
export class CheckInComponent implements OnInit {
  auth = inject(AuthService);
  checkInService = inject(CheckInService);

  isProcessing = this.checkInService.isProcessing;
  lastResult = this.checkInService.lastResult;
  readonly isScannerExpanded = signal(false);
  readonly manualFeedback = signal<ManualFeedback | null>(null);
  private readonly recentTicketCheckIns = signal<Record<string, number>>({});
  private readonly recentGuestCheckIns = signal<Record<string, number>>({});

  // Config
  private readonly isRootAdmin = computed(
    () => this.auth.userRole() === 'root_admin',
  );

  private readonly eventsQueries = injectQueries(() => ({
    admin: this.isRootAdmin()
      ? {query: api.events.management.adminList, args: {}}
      : skipToken,
    staff: this.isRootAdmin()
      ? skipToken
      : {query: api.communities.scanners.myScannerEvents, args: {}},
  }));

  /**
   * Raw query data (undefined when the query is still loading). Used by the
   * reconciliation effect to distinguish "no events yet — wait" from
   * "events loaded and the selected one is gone — clear".
   */
  private readonly rawEventsData = computed(() => {
    if (this.isRootAdmin()) {
      return this.eventsQueries.results().admin;
    }
    return this.eventsQueries.results().staff;
  });

  readonly events = computed(() => this.rawEventsData() ?? []);

  readonly exitRoute = computed(() =>
    this.isRootAdmin() ? '/admin/communities' : '/',
  );
  readonly panelLabel = computed(() =>
    this.isRootAdmin() ? 'Scanner' : 'Door Staff',
  );

  // Signals
  readonly checkInModel = signal({eventId: '' as string, filter: ''});
  f = form(this.checkInModel);

  readonly selectedEventId = computed(
    () => (this.checkInModel().eventId as Id<'events'>) || null,
  );

  private readonly rosterQueries = injectQueries(() => {
    const eventId = this.selectedEventId();
    return {
      tickets: eventId
        ? {query: api.tickets.public.listByEvent, args: {eventId}}
        : skipToken,
      guests: eventId
        ? {query: api.events.guests.listByEvent, args: {eventId}}
        : skipToken,
    };
  });

  /**
   * Stale-data guard for event switch A→B.
   *
   * convex-angular preserves the last successful `data()` across arg changes
   * for UX continuity (see QueryResult docs in `convex-angular/index.d.ts`
   * around `isLoading` / `data`). On a check-in screen that preservation is a
   * correctness risk: during the A→B switch the UI would render event-A's
   * roster against event-B's title, so a scanner could wave through a ticket
   * that is not valid for the displayed event.
   *
   * Policy: return `[]` whenever no event is selected or the query is still
   * loading. Rows populate only once the fresh event's data has arrived.
   * Any future policy change (e.g. show stale rows with a disabled state)
   * belongs in this helper — do NOT reintroduce imperative setters in effects.
   */
  private computeRosterForSelectedEvent<T extends {_id: string}>(
    data: readonly T[] | undefined,
    isLoading: boolean,
  ): T[] {
    if (!this.selectedEventId()) return [];
    if (isLoading) return [];
    return data ? [...data] : [];
  }

  // Roster + loading state derive directly from the query signals — single
  // source of truth, no effect/setter mirror.
  readonly tickets = computed<Ticket[]>(() =>
    this.computeRosterForSelectedEvent(
      this.rosterQueries.results().tickets,
      this.rosterQueries.statuses().tickets === 'pending',
    ),
  );
  readonly guests = computed<Guest[]>(() =>
    this.computeRosterForSelectedEvent(
      this.rosterQueries.results().guests,
      this.rosterQueries.statuses().guests === 'pending',
    ),
  );

  // injectQueries exposes per-key state only through the aggregate `statuses()`
  // record — there is no per-key `isLoading` signal to re-export. Derive each
  // roster's loading flag from its OWN key's status, never the aggregate
  // `isLoading()` (which spans both keys and would gate one roster on the
  // other's fetch). Matches the repo idiom (dashboard-page-data, community-admin).
  readonly isLoadingTickets = computed(
    () => this.rosterQueries.statuses().tickets === 'pending',
  );
  readonly isLoadingGuests = computed(
    () => this.rosterQueries.statuses().guests === 'pending',
  );

  readonly activeTab = signal<'tickets' | 'guests'>('tickets');

  // Precomputed searchable lists
  readonly searchableTickets = computed<SearchableTicket[]>(() => {
    return this.tickets().map((t) => ({
      ...t,
      searchStr:
        `${t._id} ${t.user?.name || ''} ${t.user?.email || ''} ${t.guestEmail || ''} ${t.tier}`.toLowerCase(),
    }));
  });

  readonly searchableGuests = computed<SearchableGuest[]>(() => {
    return this.guests().map((g) => ({
      ...g,
      searchStr: `${g.name} ${g.email || ''} ${g.type}`.toLowerCase(),
    }));
  });

  // Computed filtered lists
  readonly filteredTickets = computed(() => {
    const all = this.searchableTickets();
    const term = this.checkInModel().filter?.toLowerCase() || '';
    if (!term) return all;

    return all.filter((t) => t.searchStr.includes(term));
  });

  readonly filteredGuests = computed(() => {
    const all = this.searchableGuests();
    const term = this.checkInModel().filter?.toLowerCase() || '';
    if (!term) return all;

    return all.filter((g) => g.searchStr.includes(term));
  });

  readonly eventTitle = computed(() => {
    const id = this.selectedEventId();
    if (!id) return null;
    const ev = this.events().find(
      (e: {_id: Id<'events'>; title: string}) => e._id === id,
    );
    return ev?.title || 'Unknown Event';
  });

  constructor() {
    // Clear previous results when event changes
    effect(() => {
      this.selectedEventId();
      this.checkInService.lastResult.set(null);
      this.manualFeedback.set(null);
      this.recentTicketCheckIns.set({});
      this.recentGuestCheckIns.set({});
    });

    // Clear stale dropdown selection when the selected event disappears from
    // the events list (e.g., an organizer cancels or unpublishes an event while
    // a scanner has it selected). Without this, the scanner ends up with an
    // empty ticket/guest list and no indication why.
    //
    // Guarded against the initial loading state: only reconcile when the events
    // query has actually returned data (rawEventsData !== undefined). Treating a
    // loading query as "empty" would clobber legitimate selections on first render.
    effect(() => {
      const data = this.rawEventsData();
      if (data === undefined) return;
      const selectedId = this.selectedEventId();
      this.reconcileSelectedEventSelection(data, selectedId);
    });
  }

  ngOnInit() {
    this.checkInService.initAudio();
  }

  /**
   * Clear the dropdown selection if the currently selected event is no longer
   * present in the events list (cancelled, unpublished, or access revoked).
   * Shows a warning toast so the scanner understands why the list emptied.
   *
   * Exposed as a method so it can be unit-tested without mocking the Convex
   * subscription pipeline.
   */
  reconcileSelectedEventSelection(
    currentEvents: readonly {_id: string}[],
    selectedId: Id<'events'> | null,
  ): void {
    if (!selectedId) return;
    const stillPresent = currentEvents.some((e) => e._id === selectedId);
    if (stillPresent) return;
    this.checkInModel.update((m) => ({...m, eventId: ''}));
    toast.warning('Event is no longer available');
  }

  /** Called by the scanner child when a QR code is detected. */
  onQRScanned(data: string): void {
    this.checkInService.triggerHaptic();
    void this.checkInService.checkIn(data);
  }

  /** Check in a ticket from the manual list. */
  async checkInTicket(scanData: string): Promise<void> {
    await this.checkInService.checkIn(scanData);
    this.applyManualCheckInResult('ticket', scanData, this.lastResult());
  }

  /** Check in a guest from the guest list. */
  async checkInGuest(guestId: string): Promise<void> {
    await this.checkInService.checkInGuest(guestId);
    this.applyManualCheckInResult('guest', guestId, this.lastResult());
  }

  enableScannerSounds(): void {
    void this.checkInService.enableSoundFromGesture();
  }

  onEventSelectionChange(event: Event): void {
    const eventId = readInputValue(event.target);
    if (eventId === null) return;
    this.checkInModel.update((m) => ({...m, eventId}));
  }

  ticketCheckInLabel(ticket: Ticket, rowIndex: number): string {
    const attendee =
      ticket.user?.name ||
      ticket.user?.email ||
      ticket.guestEmail ||
      'attendee';
    const tier = ticket.tier || 'ticket';
    const status = ticket.status || 'unknown status';
    return `Check in ticket row ${rowIndex + 1}, ${tier} ticket, status ${status}, id ${this.idSuffix(ticket._id)}, for ${attendee}`;
  }

  guestCheckInLabel(guest: Guest, rowIndex: number): string {
    const type = guest.type || 'guest';
    const name = guest.name || 'guest';
    return `Check in guest row ${rowIndex + 1}, ${type}, id ${this.idSuffix(guest._id)}, for ${name}`;
  }

  isTicketRecentlyCheckedIn(ticketId: string): boolean {
    return this.recentTicketCheckIns()[ticketId] !== undefined;
  }

  ticketCheckedInAt(ticket: Ticket): number | undefined {
    return ticket.checkedInAt ?? this.recentTicketCheckIns()[ticket._id];
  }

  guestCheckedInAt(guest: Guest): number | undefined {
    return guest.checkedInAt ?? this.recentGuestCheckIns()[guest._id];
  }

  private applyManualCheckInResult(
    type: 'ticket' | 'guest',
    id: string,
    result: CheckInResult | null,
  ): void {
    if (!result) {
      this.manualFeedback.set({
        kind: 'error',
        message: `${type === 'ticket' ? 'Ticket' : 'Guest'} check-in did not start.`,
      });
      return;
    }

    if (!result.success) {
      this.manualFeedback.set({kind: 'error', message: result.message});
      return;
    }

    const checkedInAt =
      type === 'ticket'
        ? result.ticket?.checkedInAt
        : result.guest?.checkedInAt;
    const timestamp = checkedInAt ?? Date.now();

    if (type === 'ticket') {
      this.recentTicketCheckIns.update((current) => ({
        ...current,
        [id]: timestamp,
      }));
    } else {
      this.recentGuestCheckIns.update((current) => ({
        ...current,
        [id]: timestamp,
      }));
    }

    this.manualFeedback.set({
      kind: 'success',
      message:
        type === 'ticket'
          ? 'Ticket checked in. Row marked verified.'
          : 'Guest checked in. Row marked checked in.',
    });
  }

  private idSuffix(id: string): string {
    return (id.length <= 8 ? id : id.slice(-6)).toUpperCase();
  }
}
