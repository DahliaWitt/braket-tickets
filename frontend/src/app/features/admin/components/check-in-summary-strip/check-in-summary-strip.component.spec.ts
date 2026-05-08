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
import {functionReferenceMatches} from '@/testing/convex-reference-matchers';
import {type Id} from '@convex/_generated/dataModel';
import {CheckInSummaryStripComponent} from './check-in-summary-strip.component';
import {CheckInSummaryStripHarness} from './check-in-summary-strip.component.harness';

const EVENT_ID = 'event-1' as Id<'events'>;

interface SummaryData {
  totalActive: number;
  checkedIn: number;
  rate: number;
  lastCheckInAt: number | null;
}

interface PostMortemData {
  peakHourStartsAt: number | null;
  peakHourCount: number;
  totalCheckedIn: number;
}

function makeMockConvex(
  summaryData: SummaryData | null,
  postMortemData: PostMortemData | null = null,
): MockConvexClient {
  const mock = createMockConvexClient();
  mock.onUpdate = vi
    .fn()
    .mockImplementation(
      (_query: unknown, _args: unknown, onData: (data: unknown) => void) => {
        if (
          functionReferenceMatches(
            _query,
            api.events.analytics.getEventCheckInPostMortem,
          )
        ) {
          if (postMortemData) onData(postMortemData);
        } else if (
          functionReferenceMatches(
            _query,
            api.events.analytics.getEventCheckInSummary,
          )
        ) {
          if (summaryData) onData(summaryData);
        }
        return () => void 0;
      },
    );
  mock.client.onUpdate = mock.onUpdate;
  return mock;
}

async function getHarness(
  fix: ComponentFixture<CheckInSummaryStripComponent>,
): Promise<CheckInSummaryStripHarness> {
  return TestbedHarnessEnvironment.harnessForFixture(
    fix,
    CheckInSummaryStripHarness,
  );
}

describe('CheckInSummaryStripComponent', () => {
  let fixture: ComponentFixture<CheckInSummaryStripComponent>;

  const setup = async (
    mock: MockConvexClient,
    mode: 'pre-event' | 'door-rush' | 'post-event' = 'door-rush',
  ) => {
    await TestBed.configureTestingModule({
      imports: [CheckInSummaryStripComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: mock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CheckInSummaryStripComponent);
    fixture.componentRef.setInput('eventId', EVENT_ID);
    fixture.componentRef.setInput('mode', mode);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  afterEach(() => {
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('should render correct check-in rate from summary data', async () => {
    const mock = makeMockConvex({
      totalActive: 100,
      checkedIn: 47,
      rate: 0.47,
      lastCheckInAt: null,
    });
    await setup(mock);
    const harness = await getHarness(fixture);
    expect(await harness.getCheckInRate()).toContain('47%');
  });

  it('should show em dash for rate when no data', async () => {
    await setup(makeMockConvex(null));
    const harness = await getHarness(fixture);
    expect(await harness.getCheckInRate()).toContain('—');
  });

  it('should handle null lastCheckInAt gracefully', async () => {
    const mock = makeMockConvex({
      totalActive: 50,
      checkedIn: 10,
      rate: 0.2,
      lastCheckInAt: null,
    });
    await setup(mock);
    const harness = await getHarness(fixture);
    // Last scan cell should show em dash
    expect(await harness.getLastScanRelative()).toContain('—');
  });

  it('should show relative time when lastCheckInAt is set', async () => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const mock = makeMockConvex({
      totalActive: 50,
      checkedIn: 20,
      rate: 0.4,
      lastCheckInAt: fiveMinutesAgo,
    });
    await setup(mock);
    const harness = await getHarness(fixture);
    const text = await harness.getLastScanRelative();
    // Should show something like "5m ago"
    expect(text).toMatch(/\dm ago|just now/);
  });

  it('should hide peak hour in door-rush mode', async () => {
    const mock = makeMockConvex(
      {totalActive: 100, checkedIn: 50, rate: 0.5, lastCheckInAt: null},
      {
        peakHourStartsAt: Date.now() - 2 * 60 * 60 * 1000,
        peakHourCount: 42,
        totalCheckedIn: 50,
      },
    );
    await setup(mock, 'door-rush');
    const harness = await getHarness(fixture);
    // No peak hour element in door-rush mode
    expect(await harness.getPeakHour()).toBeNull();
  });

  it('should show peak hour in post-event mode', async () => {
    const peakStart = new Date(2025, 0, 15, 20, 0, 0).getTime(); // 8 PM
    const mock = makeMockConvex(
      {totalActive: 100, checkedIn: 80, rate: 0.8, lastCheckInAt: null},
      {peakHourStartsAt: peakStart, peakHourCount: 47, totalCheckedIn: 80},
    );
    await setup(mock, 'post-event');
    fixture.detectChanges();
    await fixture.whenStable();
    const harness = await getHarness(fixture);

    expect(await harness.getPeakHour()).toBe('8–9 PM');
  });
});
