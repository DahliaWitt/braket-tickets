import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {vi, describe, it, expect, beforeEach, afterEach} from 'vitest';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {toast} from 'ngx-sonner';

import {
  EventPublishDialogComponent,
  type PublishedEvent,
} from './event-publish-dialog.component';
import {EventPublishDialogComponentHarness} from './event-publish-dialog.component.harness';
import {CONVEX} from 'convex-angular';
import {type Id} from '@convex/_generated/dataModel';

/** Minimal Convex client mock that satisfies injectConvexQuery + injectConvexMutation. */
function makeConvexClientMock() {
  const convexMock: MockConvexClient = createMockConvexClient();
  const onUpdate = vi.fn(
    (
      _queryFn: unknown,
      _args: unknown,
      onData: (v: unknown) => void,
      _onError: (e: Error) => void,
    ) => {
      onData({count: 5, cappedAt500: false});
      return () => undefined;
    },
  );

  convexMock.onUpdate = onUpdate;
  convexMock.client.onUpdate = onUpdate;
  convexMock.mutation = vi.fn().mockResolvedValue(undefined);
  convexMock.action = vi.fn().mockResolvedValue(undefined);
  return convexMock;
}

const FAKE_EVENT_ID = 'k5703gtv4zb4k1k11v5dcpjn1h6bfxhg' as Id<'events'>;
const FAKE_COMMUNITY_ID = 'comm1';

describe('EventPublishDialogComponent', () => {
  let fixture: ComponentFixture<EventPublishDialogComponent>;
  let component: EventPublishDialogComponent;
  let harness: EventPublishDialogComponentHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(toast, 'error').mockImplementation(() => '');

    await TestBed.configureTestingModule({
      imports: [EventPublishDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: makeConvexClientMock()},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventPublishDialogComponent);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('eventId', FAKE_EVENT_ID);
    fixture.componentRef.setInput('communityId', FAKE_COMMUNITY_ID);
    fixture.componentRef.setInput('isOpen', false);

    fixture.detectChanges();
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      EventPublishDialogComponentHarness,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not render the dialog when isOpen is false', () => {
    return expect(harness.isOpen()).resolves.toBe(false);
  });

  it('should render the dialog when isOpen is set to true', async () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isOpen()).toBe(true);
    expect(await harness.isDialogVisible()).toBe(true);
  });

  it('selects announcement options via mouse and label clicks', async () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getSelectedAnnouncementChoice()).toBe('now');

    await harness.selectAnnouncementChoice('skip');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.announcementChoice()).toBe('skip');
    expect(await harness.getSelectedAnnouncementChoice()).toBe('skip');

    await harness.clickAnnouncementChoiceLabel('scheduled');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.announcementChoice()).toBe('scheduled');
    expect(await harness.getSelectedAnnouncementChoice()).toBe('scheduled');
    expect(await harness.isScheduleDateInputVisible()).toBe(true);
  });

  it('does not let bubbled radio Space keydown close the dialog', async () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.keydownAnnouncementChoice('skip', ' ');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isOpen()).toBe(true);
    expect(await harness.isOpen()).toBe(true);
  });

  it('should close the dialog and emit published when confirm is clicked with "skip"', async () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await fixture.whenStable();

    component.announcementChoice.set('skip');
    fixture.detectChanges();

    const publishedEvents: PublishedEvent[] = [];
    component.published.subscribe((e) => publishedEvents.push(e));

    await component.confirmPublish();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.isOpen()).toBe(false);
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]).toEqual({mode: 'skip'});
  });

  it('should emit published with announcement "now" when confirmed', async () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await fixture.whenStable();

    component.announcementChoice.set('now');
    fixture.detectChanges();

    const publishedEvents: PublishedEvent[] = [];
    component.published.subscribe((e) => publishedEvents.push(e));

    await component.confirmPublish();

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]).toEqual({mode: 'now'});
  });

  it('should emit published with "scheduled" and computed scheduledFor', async () => {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await fixture.whenStable();

    component.announcementChoice.set('scheduled');
    // Use a local Date (not UTC midnight) to avoid timezone issues
    component.scheduledDate.set(new Date(2030, 11, 15)); // Dec 15, 2030
    component.scheduledTime.set('14:30');
    fixture.detectChanges();

    const publishedEvents: PublishedEvent[] = [];
    component.published.subscribe((e) => publishedEvents.push(e));

    await component.confirmPublish();

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0].mode).toBe('scheduled');

    const expected = new Date(2030, 11, 15);
    expected.setHours(14, 30, 0, 0);
    expect(
      (publishedEvents[0] as Extract<PublishedEvent, {mode: 'scheduled'}>)
        .scheduledFor,
    ).toBe(expected.getTime());
  });

  describe('buildScheduledForMs()', () => {
    it('returns null when date is not set', () => {
      component.scheduledDate.set(null);
      component.scheduledTime.set('10:00');
      expect(component.buildScheduledForMs()).toBeNull();
    });

    it('returns null when time is empty', () => {
      component.scheduledDate.set(new Date(2030, 5, 1));
      component.scheduledTime.set('');
      expect(component.buildScheduledForMs()).toBeNull();
    });

    it('correctly combines date and time into local epoch ms', () => {
      component.scheduledDate.set(new Date(2030, 5, 1)); // Jun 1, 2030
      component.scheduledTime.set('09:15');

      const result = component.buildScheduledForMs();
      const expected = new Date(2030, 5, 1);
      expected.setHours(9, 15, 0, 0);
      expect(result).toBe(expected.getTime());
    });
  });

  describe('local date handling', () => {
    it('formats scheduledDateIso using local calendar fields', () => {
      component.scheduledDate.set(new Date(2030, 3, 2)); // Apr 2, 2030
      expect(component.scheduledDateIso()).toBe('2030-04-02');
    });

    it('parses date input values as local dates before combining with time', () => {
      const input = document.createElement('input');
      input.value = '2030-04-02';

      component.onScheduledDateChange({target: input} as unknown as Event);
      component.scheduledTime.set('10:00');

      const result = component.buildScheduledForMs();
      const expected = new Date(2030, 3, 2);
      expected.setHours(10, 0, 0, 0);

      expect(result).toBe(expected.getTime());
    });
  });
});
