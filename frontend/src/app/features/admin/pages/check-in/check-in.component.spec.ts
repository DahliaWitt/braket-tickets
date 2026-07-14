import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection, signal, computed} from '@angular/core';
import {provideRouter} from '@angular/router';
import {CheckInComponent} from './check-in.component';
import {CheckInComponentHarness} from './check-in.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {CONVEX} from 'convex-angular';
import {afterEach, vi, type Mock, type MockInstance} from 'vitest';
import {toast} from 'ngx-sonner';
import {api} from '@convex/_generated/api';
import {
  type FunctionReference,
  type FunctionReturnType,
  getFunctionName,
} from 'convex/server';
import {type Id, type Doc} from '@convex/_generated/dataModel';
import {type MockConvexClient} from '../../../../../testing/mock-types';
import {MockWebHaptics} from '@/testing/mock-web-haptics';
import {WEB_HAPTICS_CTOR} from '../../services/web-haptics.token';
import {QR_SCANNER_CTOR} from '../../components/check-in-scanner/qr-scanner.token';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';

type Ticket = FunctionReturnType<typeof api.tickets.public.listByEvent>[0];
type Guest = FunctionReturnType<typeof api.events.guests.listByEvent>[0];
type AdminEvent = FunctionReturnType<typeof api.events.management.adminList>[0];
type ScannerEvent = FunctionReturnType<
  typeof api.communities.scanners.myScannerEvents
>[0];
type UserRole = 'root_admin' | 'community_admin' | 'user';
type RevertCheckInResult = FunctionReturnType<
  typeof api.events.check_in.revertCheckIn
>;
type ConfirmDialogConfig = Parameters<BraAlertDialogService['confirm']>[0];

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

class MockQrScanner {
  start = vi.fn().mockResolvedValue(undefined);
  stop = vi.fn();
  destroy = vi.fn();
}

describe('CheckInComponent', () => {
  let fixture: ComponentFixture<CheckInComponent>;
  let harness: CheckInComponentHarness;
  let authServiceMock: Pick<AuthService, 'user' | 'currentUser' | 'userRole'>;
  let convexClientMock: Pick<
    MockConvexClient,
    | 'mutation'
    | 'action'
    | 'client'
    | 'onUpdate'
    | 'query'
    | 'onPaginatedUpdate_experimental'
    | 'localQueryResult'
    | 'connectionState'
    | 'subscribeToConnectionState'
    | 'handleAuthError'
  >;
  let destroySpy: ReturnType<typeof vi.spyOn>;
  let userRoleSignal: ReturnType<typeof signal<UserRole>>;
  let alertDialogMock: {confirm: ReturnType<typeof vi.fn>};

  // ── convex-angular subscription mock ──────────────────────────────────────
  //
  // convex-angular subscribes to queries via `convex.onUpdate(query, args, cb)`.
  // The `query` argument is an `anyApi` proxy — property access returns a fresh
  // proxy object every time, so `api.tickets.public.listByEvent === api.tickets.public.listByEvent`
  // is `false`. Reference identity cannot key the Map. Convex exposes
  // `getFunctionName(ref)` for exactly this purpose: it returns a stable
  // string like `"tickets:listByEvent"`.
  //
  // Args are also part of the identity. When `selectedEventId()` changes from
  // event-A to event-B, `injectQuery`'s `argsFn` produces new args, and
  // convex-angular tears down the old subscription and opens a new one for the
  // new args. Keying Map entries by `name:JSON(args)` means concurrent
  // subscriptions for different events coexist cleanly, while a fresh arg
  // subscription (new event, never seeded) stays in `isLoading=true` until the
  // test explicitly seeds it.
  //
  // Constraint: one active subscription per (name, args) pair. The real
  // convex-angular cleans up the old subscription before opening the new one
  // on arg change (see `cleanupSubscription()` in
  // `convex-angular/fesm2022/convex-angular.mjs` ~line 1154), so this
  // constraint holds in practice. The map-overwrite semantics of `Map.set`
  // would silently drop a stale subscriber otherwise — acceptable because
  // the stale subscriber's generation check in convex-angular ignores its
  // own late callbacks anyway.
  let querySubscribers: Map<string, (result: unknown) => void>;
  let lastSeeded: Map<string, unknown>;

  const keyFor = (ref: FunctionReference<'query'>, args: unknown): string =>
    `${getFunctionName(ref)}:${JSON.stringify(args ?? null)}`;

  const seedQuery = (
    ref: FunctionReference<'query'>,
    args: unknown,
    result: unknown,
  ): void => {
    const key = keyFor(ref, args);
    lastSeeded.set(key, result);
    const cb = querySubscribers.get(key);
    if (!cb) {
      throw new Error(
        `No active subscription for query "${key}". Set selectedEventId() / trigger subscription before seeding.`,
      );
    }
    cb(result);
  };
  const seedTickets = (eventId: string, data: Ticket[]) =>
    seedQuery(api.tickets.public.listByEvent, {eventId}, data);
  const seedGuests = (eventId: string, data: Guest[]) =>
    seedQuery(api.events.guests.listByEvent, {eventId}, data);
  const seedEvents = (data: AdminEvent[]) =>
    seedQuery(api.events.management.adminList, {}, data);
  const seedScannerEvents = (data: ScannerEvent[]) =>
    seedQuery(api.communities.scanners.myScannerEvents, {}, data);
  const makeScannerEvent = (id: string, title: string): ScannerEvent => ({
    _id: id as Id<'events'>,
    _creationTime: 0,
    date: '2026-05-01',
    organizerId: 'organizer-1' as Id<'organizers'>,
    posterUrl: null,
    price: 0,
    status: 'published',
    title,
    totalTickets: 100,
    visibility: 'public',
  });
  const makeAdminEvent = (id: string, title: string): AdminEvent => ({
    ...makeScannerEvent(id, title),
  });
  const setUserRole = async (role: UserRole): Promise<void> => {
    userRoleSignal.set(role);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const mockCheckInResult = {
    success: true,
    message: 'Successfully checked in: Test Event',
    ticket: {
      _id: 'ticket-123',
      status: 'used',
      event: {_id: 'event-1', title: 'Test Event'},
      user: {_id: 'user-1', name: 'testuser', email: 'test@example.com'},
    },
  };

  beforeEach(async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi
          .fn()
          .mockResolvedValue([{kind: 'videoinput', deviceId: '1'}]),
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: vi.fn().mockReturnValue([]),
        }),
      },
      writable: true,
    });

    Object.defineProperty(navigator, 'vibrate', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });

    vi.stubGlobal(
      'Audio',
      vi.fn().mockImplementation(function () {
        return {
          play: vi.fn().mockResolvedValue(undefined),
          pause: vi.fn(),
        };
      }),
    );

    const userSignal = signal<
      | (Doc<'users'> & {
          id: Id<'users'>;
          communityAdminOrganizerIds: Id<'organizers'>[];
          isRootAdmin: boolean;
        })
      | undefined
    >({
      _id: 'admin-id' as Id<'users'>,
      _creationTime: 0,
      id: 'admin-id' as Id<'users'>,
      communityAdminOrganizerIds: [],
      isRootAdmin: true,
    });
    userRoleSignal = signal<UserRole>('root_admin');
    authServiceMock = {
      user: userSignal,
      currentUser: computed(() => userSignal() ?? null),
      userRole: computed(() => userRoleSignal()),
    };

    const mutationMock = vi.fn();
    mutationMock.mockResolvedValue(mockCheckInResult);
    querySubscribers = new Map();
    lastSeeded = new Map();
    const captureSubscription = (
      query: unknown,
      args: unknown,
      onSuccess: (result: unknown) => void,
    ) => {
      const key = keyFor(query as FunctionReference<'query'>, args);
      querySubscribers.set(key, onSuccess);
      // If this (name, args) pair was seeded on a prior subscription, replay
      // the last value so returning to a previously selected event mirrors real
      // cached query behavior.
      //
      // `queueMicrotask`, not synchronous call: `captureSubscription` runs
      // inside convex-angular's `effect(() => { ... onUpdate(...) })` at
      // `convex-angular/fesm2022/convex-angular.mjs` ~line 1176. Calling
      // `onSuccess(result)` synchronously would flip `isLoading` / `data`
      // signals while the enclosing effect is still executing, which Angular
      // flags as a reactive-graph violation ("writing to signals is not
      // allowed in a `computed` or an `effect` by default"). Deferring to a
      // microtask drops the signal writes onto the next task, after the
      // effect has settled — matching real Convex where the server's
      // response arrives asynchronously on a later microtask anyway.
      if (lastSeeded.has(key)) {
        queueMicrotask(() => {
          if (querySubscribers.get(key) === onSuccess)
            onSuccess(lastSeeded.get(key));
        });
      }
      return () => {
        if (querySubscribers.get(key) === onSuccess)
          querySubscribers.delete(key);
      };
    };
    convexClientMock = {
      mutation: mutationMock,
      action: vi.fn(),
      onUpdate: vi.fn().mockImplementation(captureSubscription),
      query: vi.fn(),
      onPaginatedUpdate_experimental: vi.fn(),
      localQueryResult: vi.fn().mockReturnValue(undefined),
      connectionState: vi.fn().mockReturnValue({
        hasInflightRequests: false,
        isWebSocketConnected: true,
        timeOfOldestInflightRequest: null,
        hasEverConnected: true,
        connectionCount: 1,
        connectionRetries: 0,
        inflightMutations: 0,
        inflightActions: 0,
      }),
      subscribeToConnectionState: vi
        .fn()
        .mockImplementation(() => () => void 0),
      handleAuthError: vi.fn(),
      client: {
        query: vi.fn(),
        mutation: vi.fn(),
        action: vi.fn(),
        onUpdate: vi.fn().mockImplementation(captureSubscription),
        onPaginatedUpdate_experimental: vi.fn(),
        localQueryResult: vi.fn().mockReturnValue(undefined),
        connectionState: vi.fn().mockReturnValue({
          hasInflightRequests: false,
          isWebSocketConnected: true,
          timeOfOldestInflightRequest: null,
          hasEverConnected: true,
          connectionCount: 1,
          connectionRetries: 0,
          inflightMutations: 0,
          inflightActions: 0,
        }),
        subscribeToConnectionState: vi
          .fn()
          .mockImplementation(() => () => void 0),
      },
    };
    alertDialogMock = {confirm: vi.fn()};

    await TestBed.configureTestingModule({
      imports: [CheckInComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: WEB_HAPTICS_CTOR, useValue: MockWebHaptics},
        {provide: QR_SCANNER_CTOR, useValue: MockQrScanner},
        {provide: AuthService, useValue: authServiceMock},
        {provide: CONVEX, useValue: convexClientMock},
        {provide: BraAlertDialogService, useValue: alertDialogMock},
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckInComponent);
    fixture.detectChanges();
    destroySpy = vi.spyOn(MockWebHaptics.prototype, 'destroy');
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      CheckInComponentHarness,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should initialize audio via CheckInService on init', () => {
    const service = fixture.componentInstance.checkInService;
    // After ngOnInit, initAudio has been called — verify Audio was constructed
    const AudioMock = (globalThis as unknown as {Audio: Mock}).Audio;
    expect(AudioMock).toHaveBeenCalledWith('/yipee.mp3');
    expect(AudioMock).toHaveBeenCalledWith('/ticketscanfail.mp3');
    expect(service).toBeTruthy();
  });

  it('should show success message when ticket is scanned', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.isProcessing.set(false);
    fixture.componentInstance.lastResult.set(null);

    await fixture.componentInstance.checkInTicket('ticket-123');
    await fixture.whenStable();
    fixture.detectChanges();

    const result = fixture.componentInstance.lastResult();
    expect(result).toBeTruthy();
    expect(result?.success).toBe(true);
    expect(result?.message).toContain('Successfully checked in');
  });

  it('should show error when scanning fails', async () => {
    (convexClientMock.mutation as unknown as Mock).mockResolvedValue({
      success: false,
      message: 'Ticket is used. Cannot check in.',
    });

    await fixture.componentInstance.checkInTicket('ticket-123');
    await fixture.whenStable();
    fixture.detectChanges();

    const result = fixture.componentInstance.lastResult();
    expect(result).toBeTruthy();
    expect(result?.success).toBe(false);
    expect(result?.message).toContain('Cannot check in');
    const AudioMock = (globalThis as unknown as {Audio: Mock}).Audio;
    expect(AudioMock).toHaveBeenCalledWith('/ticketscanfail.mp3');
  });

  it('should delegate QR scan to checkInService via onQRScanned', async () => {
    const service = fixture.componentInstance.checkInService;
    const checkInSpy = vi.spyOn(service, 'checkIn');
    const hapticSpy = vi.spyOn(service, 'triggerHaptic');

    fixture.componentInstance.onQRScanned('ticket-123');
    await fixture.whenStable();

    expect(hapticSpy).toHaveBeenCalled();
    // Scan data is forwarded along with the selected event context (undefined
    // here since no event is selected in this test) for the external fallback.
    expect(checkInSpy).toHaveBeenCalledWith('ticket-123', undefined);
  });

  it('should clean up service on destroy', () => {
    fixture.destroy();
    expect(destroySpy).toHaveBeenCalled();
  });

  it('should show a mute sounds control in the scanner card', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getSoundToggleText()).toContain('Sounds On');
  });

  it('should toggle scanner sounds off from the scanner card', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.clickSoundToggle();
    fixture.detectChanges();

    expect(fixture.componentInstance.checkInService.isSoundEnabled()).toBe(
      false,
    );
    expect(await harness.getSoundToggleText()).toContain('Sounds Off');
  });

  it('should surface a minimal fallback button when manual sound enable is needed', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.componentInstance.checkInService.showEnableSoundFallback.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.hasEnableSoundButton()).toBe(true);
  });

  it('should switch tabs correctly', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();

    await harness.switchTab('Guestlist');
    expect(fixture.componentInstance.activeTab()).toBe('guests');

    await harness.switchTab('Tickets');
    expect(fixture.componentInstance.activeTab()).toBe('tickets');
  });

  it('should filter tickets based on search term', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 't1',
        user: {name: 'Alice', email: 'alice@test.com'},
        tier: 'regular',
        status: 'valid',
      } as unknown as Ticket,
      {
        _id: 't2',
        user: {name: 'Bob', email: 'bob@test.com'},
        tier: 'supporter',
        status: 'valid',
      } as unknown as Ticket,
    ]);

    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      filter: 'Alice',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    const filtered = fixture.componentInstance.filteredTickets();
    expect(filtered.length).toBe(1);
    expect(filtered[0].user?.name).toBe('Alice');
  });

  it('gives duplicate attendee check-in buttons distinct accessible names', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 'ticket-alpha-111111',
        user: null,
        guestEmail: null,
        tier: 'regular',
        status: 'valid',
      } as unknown as Ticket,
      {
        _id: 'ticket-beta-222222',
        user: null,
        guestEmail: null,
        tier: 'supporter',
        status: 'valid',
      } as unknown as Ticket,
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getCheckInButtonLabels()).toEqual([
      'Check in ticket row 1, regular ticket, status valid, id 111111, for attendee',
      'Check in ticket row 2, supporter ticket, status valid, id 222222, for attendee',
    ]);
  });

  it('marks a manual ticket row verified and shows visible feedback after success', async () => {
    const checkedInAt = new Date('2026-05-01T21:30:00Z').getTime();
    (convexClientMock.mutation as unknown as Mock).mockResolvedValue({
      success: true,
      message: 'Successfully checked in: Test Event',
      ticket: {
        _id: 'ticket-123',
        _creationTime: 0,
        eventId: 'event-1',
        status: 'used',
        tier: 'regular',
        checkedInAt,
      },
    });
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 'ticket-123',
        user: {name: 'Alice', email: 'alice@test.com'},
        tier: 'regular',
        status: 'valid',
      } as unknown as Ticket,
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.clickCheckInOnItem(0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getManualFeedbackText()).toContain(
      'Ticket checked in. Row marked verified.',
    );
    expect(await harness.getListItemText(0)).toContain('Verified');
    expect(await harness.getCheckInButtonLabels()).toEqual([]);
    expect(await harness.getTicketRevertButtonLabels()).toHaveLength(1);
  });

  it('offers an accessible undo action for a used native ticket', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 'ticket-alpha-111111',
        user: {name: 'Alice', email: 'alice@test.com'},
        tier: 'regular',
        status: 'used',
        checkedInAt: new Date('2026-05-01T21:30:00Z').getTime(),
      } as unknown as Ticket,
    ]);
    await fixture.whenStable();

    expect(await harness.getTicketRevertButtonLabels()).toEqual([
      'Undo check-in for ticket row 1, id 111111, for Alice',
    ]);
  });

  it('requires confirmation, shows progress, and restores a reverted ticket to an actionable state', async () => {
    const deferred = createDeferred<RevertCheckInResult>();
    (convexClientMock.mutation as unknown as Mock).mockImplementation(
      (reference: FunctionReference<'mutation'>) =>
        getFunctionName(reference) ===
        getFunctionName(api.events.check_in.revertCheckIn)
          ? deferred.promise
          : Promise.resolve(mockCheckInResult),
    );
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 'ticket-used',
        user: {name: 'Alice', email: 'alice@test.com'},
        tier: 'regular',
        status: 'used',
        checkedInAt: new Date('2026-05-01T21:30:00Z').getTime(),
      } as unknown as Ticket,
    ]);
    await fixture.whenStable();

    await harness.clickTicketRevertOnItem(0);

    expect(alertDialogMock.confirm).toHaveBeenCalledTimes(1);
    expect(convexClientMock.mutation).not.toHaveBeenCalledWith(
      api.events.check_in.revertCheckIn,
      expect.anything(),
    );

    const config = alertDialogMock.confirm.mock.calls[0]?.[0] as
      ConfirmDialogConfig | undefined;
    expect(config?.zTitle).toBe('Undo check-in?');
    config?.zOnOk?.(undefined);

    await expect
      .poll(() => harness.getTicketRevertButtonText(0))
      .toBe('Undoing...');
    expect(await harness.isTicketRevertButtonDisabled(0)).toBe(true);

    deferred.resolve({
      success: true,
      message: 'Check-in reverted successfully',
    });

    await expect
      .poll(() => harness.getManualFeedbackText())
      .toContain('Check-in undone. Ticket is valid again.');
    expect(await harness.getTicketRevertButtonLabels()).toEqual([]);
    expect(await harness.getCheckInButtonLabels()).toHaveLength(1);

    seedTickets('event-1', [
      {
        _id: 'ticket-used',
        user: {name: 'Alice', email: 'alice@test.com'},
        tier: 'regular',
        status: 'refunded',
      } as unknown as Ticket,
    ]);
    await fixture.whenStable();

    expect(await harness.getListItemText(0)).toContain('refunded');
    expect(await harness.getCheckInButtonLabels()).toEqual([]);
    expect(await harness.getTicketRevertButtonLabels()).toEqual([]);
  });

  it('keeps a used ticket undoable and shows the failure reason when revert fails', async () => {
    (convexClientMock.mutation as unknown as Mock).mockImplementation(
      (reference: FunctionReference<'mutation'>) =>
        getFunctionName(reference) ===
        getFunctionName(api.events.check_in.revertCheckIn)
          ? Promise.resolve({
              success: false,
              message: 'Cannot revert check-in: ticket is refunded',
            })
          : Promise.resolve(mockCheckInResult),
    );
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 'ticket-used',
        user: {name: 'Alice', email: 'alice@test.com'},
        tier: 'regular',
        status: 'used',
        checkedInAt: new Date('2026-05-01T21:30:00Z').getTime(),
      } as unknown as Ticket,
    ]);
    await fixture.whenStable();

    await harness.clickTicketRevertOnItem(0);
    const config = alertDialogMock.confirm.mock.calls[0]?.[0] as
      ConfirmDialogConfig | undefined;
    config?.zOnOk?.(undefined);

    await expect
      .poll(() => harness.getManualFeedbackText())
      .toContain('Cannot revert check-in: ticket is refunded');
    expect(await harness.getTicketRevertButtonLabels()).toHaveLength(1);
    expect(await harness.getCheckInButtonLabels()).toEqual([]);
  });

  it('keeps a manual ticket actionable and shows the failure reason when check-in fails', async () => {
    (convexClientMock.mutation as unknown as Mock).mockResolvedValue({
      success: false,
      message: 'Ticket is refunded. Cannot check in.',
    });
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 'ticket-refunded',
        user: {name: 'Refunded User', email: 'refund@test.com'},
        tier: 'regular',
        status: 'valid',
      } as unknown as Ticket,
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.clickCheckInOnItem(0);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getManualFeedbackText()).toContain(
      'Ticket is refunded. Cannot check in.',
    );
    expect(await harness.getCheckInButtonLabels()).toHaveLength(1);
  });

  it('should filter guests case-insensitively by both name and type', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    seedGuests('event-1', [
      {
        _id: 'g1',
        name: 'Charlie VIP',
        type: 'guest',
      } as unknown as Guest,
      {
        _id: 'g2',
        name: 'Diana Artist',
        type: 'artist guest',
      } as unknown as Guest,
    ]);

    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      filter: 'charlie',
    }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      fixture.componentInstance.filteredGuests().map((g) => g.name),
    ).toEqual(['Charlie VIP']);

    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      filter: 'ARTIST',
    }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(
      fixture.componentInstance.filteredGuests().map((g) => g.name),
    ).toEqual(['Diana Artist']);
  });

  it('gives guest check-in buttons distinct accessible names', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    seedGuests('event-1', [
      {
        _id: 'guest-alpha-111111',
        name: 'Door Guest',
        type: 'guest',
      } as unknown as Guest,
      {
        _id: 'guest-beta-222222',
        name: 'Door Guest',
        type: 'artist guest',
      } as unknown as Guest,
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.switchTab('Guestlist');

    expect(await harness.getCheckInButtonLabels()).toEqual([
      'Check in guest row 1, guest, id 111111, for Door Guest',
      'Check in guest row 2, artist guest, id 222222, for Door Guest',
    ]);
  });

  it('should filter tickets by tier case-insensitively', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 't-regular',
        user: {name: 'Regular User', email: 'regular@test.com'},
        tier: 'regular',
        status: 'valid',
      } as unknown as Ticket,
      {
        _id: 't-supporter',
        user: {name: 'Supporter User', email: 'supporter@test.com'},
        tier: 'supporter',
        status: 'valid',
      } as unknown as Ticket,
    ]);
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      filter: 'SUPPORTER',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    const filtered = fixture.componentInstance.filteredTickets();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].user?.name).toBe('Supporter User');
  });

  it('should filter tickets by guest email for guest checkout tickets', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 't-guest',
        user: null,
        guestEmail: 'guest@checkout.com',
        tier: 'regular',
        status: 'valid',
      } as unknown as Ticket,
      {
        _id: 't-authed',
        user: {name: 'Auth User', email: 'auth@test.com'},
        tier: 'regular',
        status: 'valid',
      } as unknown as Ticket,
    ]);

    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      filter: 'guest@checkout',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    const filtered = fixture.componentInstance.filteredTickets();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].guestEmail).toBe('guest@checkout.com');
  });

  it('should return zero filtered tickets when filter matches no records', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    seedTickets('event-1', [
      {
        _id: 't1',
        user: {name: 'Someone Here', email: 'someone@test.com'},
        tier: 'regular',
        status: 'valid',
      } as unknown as Ticket,
    ]);
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      filter: 'ZZZNOMATCH',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.filteredTickets()).toHaveLength(0);
  });

  it('should set selectedEventId when event selector changes', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-123',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.selectedEventId()).toBe('event-123');
  });

  it('should show scanner controls after selecting an event from the dropdown', async () => {
    await fixture.whenStable();
    seedEvents([
      makeAdminEvent('event-concrete', 'Concrete & Wax'),
      makeAdminEvent('event-low-frequency', 'Low Frequency'),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.hasEventEmptyState()).toBe(true);

    await harness.selectEventByLabel('Concrete & Wax');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getSelectedEventValue()).toBe('event-concrete');
    expect(fixture.componentInstance.selectedEventId()).toBe('event-concrete');
    expect(await harness.hasEventEmptyState()).toBe(false);
    expect(await harness.hasScannerPanel()).toBe(true);
  });

  it('should show scanner controls after scanner staff selects an assigned event', async () => {
    await setUserRole('user');

    seedScannerEvents([
      makeScannerEvent('event-backyard', 'Backyard Sessions'),
      makeScannerEvent('event-low-frequency', 'Low Frequency'),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.hasEventEmptyState()).toBe(true);

    await harness.selectEventByLabel('Backyard Sessions');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getSelectedEventValue()).toBe('event-backyard');
    expect(fixture.componentInstance.selectedEventId()).toBe('event-backyard');
    expect(await harness.hasEventEmptyState()).toBe(false);
    expect(await harness.hasScannerPanel()).toBe(true);
  });

  it('should toggle scanner expansion state', () => {
    expect(fixture.componentInstance.isScannerExpanded()).toBe(false);

    fixture.componentInstance.isScannerExpanded.set(true);
    expect(fixture.componentInstance.isScannerExpanded()).toBe(true);

    fixture.componentInstance.isScannerExpanded.set(false);
    expect(fixture.componentInstance.isScannerExpanded()).toBe(false);
  });

  it('allows the attendee roster to own vertical scrolling inside the fixed-height scanner card', async () => {
    fixture.componentInstance.checkInModel.update((m) => ({
      ...m,
      eventId: 'event-1',
    }));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getManualListCardContentClasses()).toContain(
      'min-h-0',
    );
    expect(await harness.getAttendeeListScrollContainerClasses()).toContain(
      'min-h-0',
    );
    expect(await harness.getAttendeeListScrollContainerClasses()).toContain(
      'overflow-y-auto',
    );
  });

  describe('roster stale-data guard (Option b)', () => {
    it('clears the ticket roster to [] during event switch until the new event responds', async () => {
      // Phase 1: event-A is selected and seeded — scanner shows event-A's roster.
      fixture.componentInstance.checkInModel.update((m) => ({
        ...m,
        eventId: 'event-a',
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      seedTickets('event-a', [
        {
          _id: 't-a-1',
          user: {name: 'Alice', email: 'alice@e.com'},
          tier: 'regular',
          status: 'valid',
        } as unknown as Ticket,
      ]);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.tickets()).toHaveLength(1);

      // Phase 2: switch to event-B WITHOUT seeding. convex-angular preserves
      // the last successful `data()` across arg changes, which would leak
      // event-A's ticket rows into event-B's check-in view. The component's
      // guard in `computeRosterForSelectedEvent()` must block that — the
      // roster should be `[]` (plus loader) until event-B's data actually
      // arrives.
      fixture.componentInstance.checkInModel.update((m) => ({
        ...m,
        eventId: 'event-b',
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.isLoadingTickets()).toBe(true);
      expect(fixture.componentInstance.tickets()).toEqual([]);

      // Phase 3: event-B responds — tickets populate with B's data, not stale A.
      seedTickets('event-b', [
        {
          _id: 't-b-1',
          user: {name: 'Bob', email: 'bob@e.com'},
          tier: 'vip',
          status: 'valid',
        } as unknown as Ticket,
      ]);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.tickets()).toHaveLength(1);
      expect(fixture.componentInstance.tickets()[0]._id).toBe('t-b-1');
    });

    it('preserves tickets across tab switches without imperative refetching', async () => {
      fixture.componentInstance.checkInModel.update((m) => ({
        ...m,
        eventId: 'event-1',
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      seedTickets('event-1', [
        {
          _id: 't1',
          user: {name: 'A', email: 'a@t.com'},
          tier: 'regular',
          status: 'valid',
        } as unknown as Ticket,
      ]);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.tickets()).toHaveLength(1);

      await harness.switchTab('Guestlist');
      fixture.detectChanges();
      await fixture.whenStable();
      await harness.switchTab('Tickets');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.componentInstance.tickets()).toHaveLength(1);
      expect(fixture.componentInstance.tickets()[0]._id).toBe('t1');
    });
  });

  describe('stale event selection', () => {
    let warnSpy: MockInstance<typeof toast.warning>;

    beforeEach(() => {
      warnSpy = vi.spyOn(toast, 'warning').mockImplementation(() => '');
      warnSpy.mockClear();
    });

    it('clears selection and warns when the selected event disappears from the events list', () => {
      fixture.componentInstance.checkInModel.update((m) => ({
        ...m,
        eventId: 'evt-vanished',
      }));

      // Simulate the reactive events list no longer containing the selected event
      // (e.g., organizer cancelled or unpublished it while the scanner had it open).
      fixture.componentInstance.reconcileSelectedEventSelection(
        [{_id: 'evt-other'}],
        'evt-vanished' as Id<'events'>,
      );

      expect(fixture.componentInstance.selectedEventId()).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith('Event is no longer available');
    });

    it('keeps selection when the selected event is still present', () => {
      fixture.componentInstance.checkInModel.update((m) => ({
        ...m,
        eventId: 'evt-present',
      }));

      fixture.componentInstance.reconcileSelectedEventSelection(
        [{_id: 'evt-present'}, {_id: 'evt-other'}],
        'evt-present' as Id<'events'>,
      );

      expect(fixture.componentInstance.selectedEventId()).toBe('evt-present');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('does nothing when no event is selected', () => {
      fixture.componentInstance.reconcileSelectedEventSelection([], null);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
