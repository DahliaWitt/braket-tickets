import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {vi} from 'vitest';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {type Id} from '@convex/_generated/dataModel';
import {CheckInActivityFeedComponent} from './check-in-activity-feed.component';
import {CheckInActivityFeedHarness} from './check-in-activity-feed.component.harness';
import {functionReferenceMatches} from '@/testing/convex-reference-matchers';

const EVENT_ID = 'event-1' as Id<'events'>;

interface FeedEntry {
  ticketId: Id<'tickets'>;
  attendeeName: string;
  tierName: string;
  checkedInAt: number;
  checkedInByName: string | null;
}

function makeMockConvex(entries: FeedEntry[]): MockConvexClient {
  const mock = createMockConvexClient();
  mock.onUpdate = vi
    .fn()
    .mockImplementation(
      (_query: unknown, _args: unknown, onData: (data: unknown) => void) => {
        if (
          functionReferenceMatches(
            _query,
            api.events.analytics.getRecentCheckIns,
          )
        ) {
          onData(entries);
        }
        return () => void 0;
      },
    );
  mock.client.onUpdate = mock.onUpdate;
  return mock;
}

async function getHarness(
  fix: ComponentFixture<CheckInActivityFeedComponent>,
): Promise<CheckInActivityFeedHarness> {
  return TestbedHarnessEnvironment.harnessForFixture(
    fix,
    CheckInActivityFeedHarness,
  );
}

describe('CheckInActivityFeedComponent', () => {
  let fixture: ComponentFixture<CheckInActivityFeedComponent>;

  const setup = async (mock: MockConvexClient) => {
    await TestBed.configureTestingModule({
      imports: [CheckInActivityFeedComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: mock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckInActivityFeedComponent);
    fixture.componentRef.setInput('eventId', EVENT_ID);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  afterEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('should show empty state when no entries', async () => {
    await setup(makeMockConvex([]));
    const harness = await getHarness(fixture);
    expect(await harness.isEmptyStateVisible()).toBe(true);
    expect(await harness.getFeedEntryCount()).toBe(0);
  });

  it('should not show empty state when entries exist', async () => {
    const entries: FeedEntry[] = [
      {
        ticketId: 'ticket-1' as Id<'tickets'>,
        attendeeName: 'Cheryl Tunt',
        tierName: 'REGULAR',
        checkedInAt: Date.now() - 1000,
        checkedInByName: 'Staff1',
      },
    ];
    await setup(makeMockConvex(entries));
    const harness = await getHarness(fixture);
    expect(await harness.isEmptyStateVisible()).toBe(false);
    expect(await harness.getFeedEntryCount()).toBe(1);
  });

  it('should render entries in correct order (most recent first)', async () => {
    const now = Date.now();
    const entries: FeedEntry[] = [
      {
        ticketId: 'ticket-1' as Id<'tickets'>,
        attendeeName: 'Cheryl Tunt',
        tierName: 'REGULAR',
        checkedInAt: now - 1000,
        checkedInByName: null,
      },
      {
        ticketId: 'ticket-2' as Id<'tickets'>,
        attendeeName: 'Jordan Lee',
        tierName: 'SUPPORTER',
        checkedInAt: now - 5000,
        checkedInByName: null,
      },
    ];
    await setup(makeMockConvex(entries));
    const harness = await getHarness(fixture);

    // Backend returns descending order; first entry in list should be most recent
    expect(await harness.getMostRecentEntryName()).toBe('Cheryl Tunt');
    expect(await harness.getFeedEntryCount()).toBe(2);
  });

  it('should render multiple entries', async () => {
    const now = Date.now();
    const entries: FeedEntry[] = Array.from({length: 5}, (_, i) => ({
      ticketId: `ticket-${i}` as Id<'tickets'>,
      attendeeName: `Attendee ${i + 1}`,
      tierName: 'REGULAR',
      checkedInAt: now - i * 10000,
      checkedInByName: null,
    }));
    await setup(makeMockConvex(entries));
    const harness = await getHarness(fixture);
    expect(await harness.getFeedEntryCount()).toBe(5);
  });

  it('formats check-in timestamps in the platform timezone', async () => {
    await setup(
      makeMockConvex([
        {
          ticketId: 'ticket-1' as Id<'tickets'>,
          attendeeName: 'Cheryl Tunt',
          tierName: 'REGULAR',
          checkedInAt: Date.parse('2026-02-27T07:30:15.000Z'),
          checkedInByName: null,
        },
      ]),
    );
    const harness = await getHarness(fixture);

    expect(await harness.getMostRecentEntryTimestamp()).toBe('23:30:15');
  });

  it('keeps check-in timestamps readable throughout the entry animation', async () => {
    await setup(
      makeMockConvex([
        {
          ticketId: 'ticket-1' as Id<'tickets'>,
          attendeeName: 'Cheryl Tunt',
          tierName: 'REGULAR',
          checkedInAt: Date.parse('2026-02-27T07:30:15.000Z'),
          checkedInByName: null,
        },
      ]),
    );
    const harness = await getHarness(fixture);

    const entryClasses = await harness.getMostRecentEntryClasses();
    expect(entryClasses).toContain('animate-in');
    expect(entryClasses).toContain('slide-in-from-top-3');
    expect(entryClasses).not.toContain('fade-in');

    const timestampClasses = await harness.getMostRecentEntryTimestampClasses();
    expect(timestampClasses).toContain('text-accent-text');
    expect(timestampClasses).not.toContain('text-accent');
  });

  it('should show null for most recent entry name when empty', async () => {
    await setup(makeMockConvex([]));
    const harness = await getHarness(fixture);
    expect(await harness.getMostRecentEntryName()).toBeNull();
  });
});
