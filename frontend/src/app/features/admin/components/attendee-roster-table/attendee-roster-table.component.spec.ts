import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {EVENT_MANAGER_PLUGINS} from '@angular/platform-browser';
import {vi} from 'vitest';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {functionReferenceMatches} from '@/testing/convex-reference-matchers';
import {type Id} from '@convex/_generated/dataModel';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {BraDebounceEventManagerPlugin} from '@ui/core/provider/event-manager-plugins/bra-debounce-event-manager-plugin';
import {AttendeeRosterTableComponent} from './attendee-roster-table.component';
import {AttendeeRosterTableHarness} from './attendee-roster-table.component.harness';

const SEARCH_DEBOUNCE_MS = 200;

const EVENT_ID = 'event-1' as Id<'events'>;

interface RosterRow {
  ticketId: Id<'tickets'>;
  attendeeName: string;
  email: string | null;
  tierName: string;
  purchaseDate: number;
  status: 'valid' | 'checked_in' | 'refunded' | 'cancelled';
  checkedInAt: number | null;
  checkedInByName: string | null;
}

function makeRow(
  overrides: Partial<RosterRow> & {attendeeName: string},
): RosterRow {
  return {
    ticketId: `ticket-${overrides.attendeeName}` as Id<'tickets'>,
    email:
      overrides.email ??
      `${overrides.attendeeName.toLowerCase().replace(' ', '.')}@test.com`,
    tierName: 'REGULAR',
    purchaseDate: Date.now() - 86400000,
    status: 'valid',
    checkedInAt: null,
    checkedInByName: null,
    ...overrides,
  };
}

interface PaginatedResult {
  results: RosterRow[];
  status: 'Exhausted' | 'CanLoadMore';
  loadMore: ReturnType<typeof vi.fn>;
}

function makeMockConvex(
  rosterRows: RosterRow[],
  status: 'Exhausted' | 'CanLoadMore' = 'Exhausted',
  loadMore = vi.fn().mockReturnValue(false),
  searchError?: Error,
): MockConvexClient {
  const mock = createMockConvexClient();
  const paginatedResult: PaginatedResult = {
    results: rosterRows,
    status,
    loadMore,
  };

  const onPaginatedUpdate = vi
    .fn()
    .mockImplementation(
      (
        queryRef: unknown,
        _args: unknown,
        _options: unknown,
        onData: (data: unknown) => void,
        onError?: (err: Error) => void,
      ) => {
        if (
          functionReferenceMatches(
            queryRef,
            api.events.analytics.getEventAttendeeRosterPage,
          )
        ) {
          onData(paginatedResult);
        } else if (
          functionReferenceMatches(
            queryRef,
            api.events.analytics.searchEventAttendeesPage,
          )
        ) {
          if (searchError) {
            onError?.(searchError);
            return () => void 0;
          }
          onData(paginatedResult);
        }
        return () => void 0;
      },
    );

  mock.onPaginatedUpdate_experimental = onPaginatedUpdate;
  mock.client.onPaginatedUpdate_experimental = onPaginatedUpdate;
  // Action mock for export
  mock.action = vi
    .fn()
    .mockResolvedValue({csv: 'name,email\n', filename: 'roster.csv'});
  mock.client.action = mock.action;
  return mock;
}

async function getHarness(
  fix: ComponentFixture<AttendeeRosterTableComponent>,
): Promise<AttendeeRosterTableHarness> {
  return TestbedHarnessEnvironment.harnessForFixture(
    fix,
    AttendeeRosterTableHarness,
  );
}

function paginatedArgsFor(mock: MockConvexClient, target: unknown): unknown[] {
  const calls = mock.onPaginatedUpdate_experimental.mock.calls as unknown[][];
  return calls
    .filter(([queryRef]) => functionReferenceMatches(queryRef, target))
    .map(([, args]) => args);
}

async function waitForSearchDebounce(
  fix: ComponentFixture<AttendeeRosterTableComponent>,
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 20));
  await fix.whenStable();
}

describe('AttendeeRosterTableComponent', () => {
  let fixture: ComponentFixture<AttendeeRosterTableComponent>;
  let browserPlatformMock: {
    downloadBlob: ReturnType<typeof vi.fn>;
  };

  const setup = async (mock: MockConvexClient, canExport = false) => {
    browserPlatformMock = {
      downloadBlob: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AttendeeRosterTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: EVENT_MANAGER_PLUGINS,
          useClass: BraDebounceEventManagerPlugin,
          multi: true,
        },
        {provide: CONVEX, useValue: mock},
        {provide: BrowserPlatformService, useValue: browserPlatformMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AttendeeRosterTableComponent);
    fixture.componentRef.setInput('eventId', EVENT_ID);
    fixture.componentRef.setInput('canExport', canExport);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('should render rows when data is present', async () => {
    const rows = [
      makeRow({attendeeName: 'Cheryl Tunt'}),
      makeRow({attendeeName: 'Jordan Lee'}),
    ];
    await setup(makeMockConvex(rows));
    const harness = await getHarness(fixture);
    expect(await harness.getVisibleRowCount()).toBe(2);
  });

  it('should show export button when canExport is true', async () => {
    await setup(makeMockConvex([]), true);
    const harness = await getHarness(fixture);
    expect(await harness.isExportButtonVisible()).toBe(true);
  });

  it('should hide export button when canExport is false', async () => {
    await setup(makeMockConvex([]), false);
    const harness = await getHarness(fixture);
    expect(await harness.isExportButtonVisible()).toBe(false);
  });

  it('should show email column when rows have non-null email', async () => {
    const rows = [
      makeRow({attendeeName: 'Cheryl Tunt', email: 'alex@test.com'}),
    ];
    await setup(makeMockConvex(rows));
    const harness = await getHarness(fixture);
    expect(await harness.hasColumnHeader('Email')).toBe(true);
  });

  it('should hide email column when all emails are null (door staff PII boundary)', async () => {
    const rows = [
      makeRow({attendeeName: 'Cheryl Tunt', email: null}),
      makeRow({attendeeName: 'Jordan Lee', email: null}),
    ];
    await setup(makeMockConvex(rows));
    const harness = await getHarness(fixture);
    expect(await harness.hasColumnHeader('Email')).toBe(false);
  });

  it('should find row by email', async () => {
    const rows = [
      makeRow({attendeeName: 'Cheryl Tunt', email: 'alex@test.com'}),
      makeRow({attendeeName: 'Jordan Lee', email: 'jordan@test.com'}),
    ];
    await setup(makeMockConvex(rows));
    const harness = await getHarness(fixture);
    const row = await harness.getRowByEmail('alex@test.com');
    expect(row).not.toBeNull();
  });

  it('should return null for getRowByEmail when email not found', async () => {
    const rows = [
      makeRow({attendeeName: 'Cheryl Tunt', email: 'alex@test.com'}),
    ];
    await setup(makeMockConvex(rows));
    const harness = await getHarness(fixture);
    const row = await harness.getRowByEmail('nobody@test.com');
    expect(row).toBeNull();
  });

  it('formats checked-in timestamps in the platform timezone', async () => {
    const rows = [
      makeRow({
        attendeeName: 'Cheryl Tunt',
        email: 'alex@test.com',
        checkedInAt: Date.parse('2026-02-27T07:30:00.000Z'),
      }),
    ];
    await setup(makeMockConvex(rows));
    const harness = await getHarness(fixture);

    expect(await harness.getCheckInTimeByEmail('alex@test.com')).toBe('23:30');
  });

  it('should toggle show refunded and re-query', async () => {
    const mock = makeMockConvex([makeRow({attendeeName: 'Cheryl Tunt'})]);
    await setup(mock);
    const harness = await getHarness(fixture);

    // Toggle on
    await harness.toggleShowRefunded();
    fixture.detectChanges();
    await fixture.whenStable();

    // onPaginatedUpdate should have been called again with includeRefunded: true
    expect(mock.onPaginatedUpdate_experimental).toHaveBeenCalled();
  });

  it('should show load more button when more pages available', async () => {
    const rows = [makeRow({attendeeName: 'Cheryl Tunt'})];
    await setup(makeMockConvex(rows, 'CanLoadMore'));
    const harness = await getHarness(fixture);

    expect(await harness.isLoadMoreButtonVisible()).toBe(true);
  });

  it('should trigger export action when export button clicked', async () => {
    const mock = makeMockConvex([], 'Exhausted');
    mock.action = vi
      .fn()
      .mockResolvedValue({csv: 'name\n', filename: 'test.csv'});
    mock.client.action = mock.action;

    await setup(mock, true);
    const harness = await getHarness(fixture);
    await harness.clickExport();
    await fixture.whenStable();

    expect(mock.action).toHaveBeenCalled();
    expect(browserPlatformMock.downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      'test.csv',
    );
  });

  it('should search roster when query is entered', async () => {
    const mock = makeMockConvex([makeRow({attendeeName: 'Cheryl Tunt'})]);
    await setup(mock);
    const harness = await getHarness(fixture);

    mock.onPaginatedUpdate_experimental.mockClear();

    await harness.searchRoster('Alex');
    await waitForSearchDebounce(fixture);

    // searchEventAttendeesPage paginated query should have been called
    expect(
      paginatedArgsFor(mock, api.events.analytics.searchEventAttendeesPage),
    ).toHaveLength(1);
  });

  it('should trim roster search queries before subscribing', async () => {
    const mock = makeMockConvex([makeRow({attendeeName: 'Cheryl Tunt'})]);
    await setup(mock);
    const harness = await getHarness(fixture);

    mock.onPaginatedUpdate_experimental.mockClear();

    await harness.searchRoster('  Alex  ');
    await waitForSearchDebounce(fixture);

    const searchArgs = paginatedArgsFor(
      mock,
      api.events.analytics.searchEventAttendeesPage,
    );
    expect(searchArgs).toHaveLength(1);
    expect(searchArgs[0]).toMatchObject({query: 'Alex'});
  });

  it('should not submit whitespace-only roster searches', async () => {
    const mock = makeMockConvex([makeRow({attendeeName: 'Cheryl Tunt'})]);
    await setup(mock);
    const harness = await getHarness(fixture);

    mock.onPaginatedUpdate_experimental.mockClear();

    await harness.searchRoster('   ');
    await waitForSearchDebounce(fixture);

    const searchArgs = paginatedArgsFor(
      mock,
      api.events.analytics.searchEventAttendeesPage,
    );
    expect(searchArgs).toHaveLength(0);
  });

  it('should debounce rapid roster search input before subscribing', async () => {
    const mock = makeMockConvex([makeRow({attendeeName: 'Cheryl Tunt'})]);
    await setup(mock);
    const harness = await getHarness(fixture);

    mock.onPaginatedUpdate_experimental.mockClear();

    await harness.searchRoster('A');
    await harness.searchRoster('Al');
    await harness.searchRoster('Alex');
    await fixture.whenStable();

    expect(
      paginatedArgsFor(mock, api.events.analytics.searchEventAttendeesPage),
    ).toHaveLength(0);

    await waitForSearchDebounce(fixture);

    const searchArgs = paginatedArgsFor(
      mock,
      api.events.analytics.searchEventAttendeesPage,
    );
    expect(searchArgs).toHaveLength(1);
    expect(searchArgs[0]).toMatchObject({query: 'Alex'});
  });

  it('should not auto-load more search pages after a search query error', async () => {
    const loadMore = vi.fn().mockReturnValue(true);
    const mock = makeMockConvex(
      [],
      'CanLoadMore',
      loadMore,
      new Error('search failed'),
    );
    await setup(mock);
    const harness = await getHarness(fixture);

    await harness.searchRoster('Target');
    await waitForSearchDebounce(fixture);

    expect(loadMore).not.toHaveBeenCalled();
  });

  it('should clear search and revert to roster query', async () => {
    const mock = makeMockConvex([makeRow({attendeeName: 'Cheryl Tunt'})]);
    await setup(mock);
    const harness = await getHarness(fixture);

    await harness.searchRoster('Alex');
    await waitForSearchDebounce(fixture);

    await harness.clearSearch();
    await waitForSearchDebounce(fixture);

    const rosterArgs = paginatedArgsFor(
      mock,
      api.events.analytics.getEventAttendeeRosterPage,
    );
    expect(rosterArgs.at(-1)).toMatchObject({
      eventId: EVENT_ID,
      includeRefunded: false,
    });
  });
});
