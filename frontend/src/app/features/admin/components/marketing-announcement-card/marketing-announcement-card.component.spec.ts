import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {vi, describe, it, expect, beforeEach, afterEach} from 'vitest';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {toast} from 'ngx-sonner';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {MarketingAnnouncementCardComponent} from './marketing-announcement-card.component';
import {MarketingAnnouncementCardHarness} from './marketing-announcement-card.component.harness';
import {functionReferenceMatches} from '@/testing/convex-reference-matchers';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

function toExpectedDateValue(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toExpectedTimeValue(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

describe('MarketingAnnouncementCardComponent', () => {
  let fixture: ComponentFixture<MarketingAnnouncementCardComponent>;
  let component: MarketingAnnouncementCardComponent;
  let harness: MarketingAnnouncementCardHarness;
  let convexMock: MockConvexClient;
  let marketingStatus: {
    _id: Id<'eventMarketingEmails'>;
    status: 'scheduled' | 'sent' | 'cancelled';
    scheduledFor: number;
    recipientCount?: number;
    sentAt?: number;
    totalClickCount: number;
    totalOpenCount: number;
    uniqueClickCount: number;
    uniqueOpenCount: number;
  } | null;
  let recipientCount: {
    count: number;
    cappedAt500: boolean;
    directCount: number;
    trustLinkedCount: number;
    totalCount: number;
  };
  let trustLinks: {
    direction: 'outgoing' | 'incoming';
    trustingOrganizerId: string;
    trustedOrganizerId: string;
    trustingOrganizerName: string;
    trustedOrganizerName: string;
    trustedMemberCount?: number;
  }[];
  let announcementStatusQuery: () => Promise<typeof marketingStatus>;

  const createComponent = async ({
    waitForStable = true,
    createHarness = true,
  }: {
    waitForStable?: boolean;
    createHarness?: boolean;
  } = {}) => {
    convexMock = createMockConvexClient();
    const queryMock = vi.fn((queryRef: unknown) => {
      if (
        functionReferenceMatches(
          queryRef,
          api.marketing.emails.getAnnouncementStatus,
        )
      ) {
        return announcementStatusQuery();
      }
      if (
        functionReferenceMatches(
          queryRef,
          api.marketing.emails.getRecipientCount,
        )
      ) {
        return Promise.resolve(recipientCount);
      }
      if (
        functionReferenceMatches(queryRef, api.communities.trust_links.list)
      ) {
        return Promise.resolve(trustLinks);
      }
      return Promise.resolve(null);
    });
    convexMock.query = queryMock;
    convexMock.client.query = convexMock.query;
    convexMock.mutation.mockResolvedValue('record-1');
    convexMock.client.mutation = convexMock.mutation;

    await TestBed.configureTestingModule({
      imports: [MarketingAnnouncementCardComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: convexMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MarketingAnnouncementCardComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('eventId', 'event1');
    fixture.componentRef.setInput('organizerId', 'organizer1');
    fixture.detectChanges();

    if (waitForStable) {
      await fixture.whenStable();
      fixture.detectChanges();
    }

    if (createHarness) {
      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        MarketingAnnouncementCardHarness,
      );
    }
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(toast, 'success').mockImplementation(() => '' as string & number);
    vi.spyOn(toast, 'error').mockImplementation(() => '' as string & number);
    marketingStatus = null;
    recipientCount = {
      count: 7,
      cappedAt500: false,
      directCount: 7,
      trustLinkedCount: 0,
      totalCount: 7,
    };
    trustLinks = [];
    announcementStatusQuery = () => Promise.resolve(marketingStatus);
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  it('shows the empty state when no announcement exists', async () => {
    await createComponent();

    expect(await harness.getEmptyText()).toContain(
      'No marketing announcement is scheduled yet.',
    );
  });

  it('uses the email-card spacing contract', async () => {
    await createComponent();

    expect(await harness.usesEmailCardSpacingContract()).toBe(true);
  });

  it('keeps management actions hidden while announcement status is loading', async () => {
    const deferred = createDeferred<typeof marketingStatus>();
    announcementStatusQuery = () => deferred.promise;

    await createComponent({waitForStable: false, createHarness: false});

    expect(component.hasResolvedAnnouncementStatus()).toBe(false);
    expect(component.canManageAnnouncement()).toBe(false);

    deferred.resolve(null);
  });

  it('shows scheduled announcement details and pre-fills the reschedule form', async () => {
    const scheduledForDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
    scheduledForDate.setSeconds(0, 0);
    marketingStatus = {
      _id: 'marketing1' as Id<'eventMarketingEmails'>,
      status: 'scheduled',
      scheduledFor: scheduledForDate.getTime(),
      totalClickCount: 0,
      totalOpenCount: 0,
      uniqueClickCount: 0,
      uniqueOpenCount: 0,
    };

    await createComponent();

    expect(await harness.getStatusText()).toContain('Scheduled');
    expect(await harness.hasCancelButton()).toBe(true);
    expect(await harness.getScheduleDateValue()).toBe(
      toExpectedDateValue(scheduledForDate.getTime()),
    );
    expect(await harness.getScheduleTimeValue()).toBe(
      toExpectedTimeValue(scheduledForDate.getTime()),
    );
  });

  it('reschedules using the existing scheduled time until the admin edits it', async () => {
    const scheduledForDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
    scheduledForDate.setSeconds(0, 0);
    marketingStatus = {
      _id: 'marketing1' as Id<'eventMarketingEmails'>,
      status: 'scheduled',
      scheduledFor: scheduledForDate.getTime(),
      totalClickCount: 0,
      totalOpenCount: 0,
      uniqueClickCount: 0,
      uniqueOpenCount: 0,
    };

    await createComponent();
    await harness.clickScheduleSubmit();

    expect(convexMock.mutation).toHaveBeenCalledWith(
      api.marketing.emails.scheduleAnnouncement,
      {
        eventId: 'event1',
        scheduledFor: scheduledForDate.getTime(),
        audienceScope: 'community',
      },
    );
    expect(toast.success).toHaveBeenCalledWith(
      'Marketing announcement rescheduled.',
    );
  });

  it('does not expose management actions after an announcement has already been sent', async () => {
    marketingStatus = {
      _id: 'marketing1' as Id<'eventMarketingEmails'>,
      status: 'sent',
      scheduledFor: Date.now() - 5 * 60_000,
      recipientCount: 7,
      sentAt: Date.now() - 60_000,
      totalClickCount: 2,
      totalOpenCount: 4,
      uniqueClickCount: 1,
      uniqueOpenCount: 3,
    };

    await createComponent();

    expect(await harness.getStatusText()).toContain('Sent');
    const trackingText = (await harness.getTrackingText())
      ?.replace(/\s+/g, ' ')
      .trim();
    expect(trackingText).toContain('Opens 3 / 7 · 4 total');
    expect(trackingText).toContain('Clicks 1 / 7 · 2 total');
    expect(await harness.getTrackingDisclaimerText()).toContain(
      'Open and click metrics are directional.',
    );
    expect(await harness.hasScheduleForm()).toBe(false);
    expect(await harness.hasQueueNowButton()).toBe(false);
  });

  it('queues an announcement immediately', async () => {
    await createComponent();
    await component.queueNow();

    const mutationCalls = convexMock.mutation.mock.calls as unknown[][];
    const firstCall = mutationCalls[0];
    expect(
      functionReferenceMatches(
        firstCall?.[0],
        api.marketing.emails.scheduleAnnouncement,
      ),
    ).toBe(true);

    const callArgs: unknown = firstCall?.[1];
    if (!callArgs || typeof callArgs !== 'object') {
      throw new Error('Expected scheduleAnnouncement call args');
    }

    const eventId: unknown = Reflect.get(callArgs, 'eventId');
    const scheduledFor: unknown = Reflect.get(callArgs, 'scheduledFor');
    const audienceScope: unknown = Reflect.get(callArgs, 'audienceScope');
    expect(eventId).toBe('event1');
    expect(typeof scheduledFor).toBe('number');
    expect(audienceScope).toBe('community');
    expect(toast.success).toHaveBeenCalledWith(
      'Marketing announcement queued.',
    );
  });

  it('cancels a scheduled announcement', async () => {
    marketingStatus = {
      _id: 'marketing1' as Id<'eventMarketingEmails'>,
      status: 'scheduled',
      scheduledFor: Date.now() + 2 * 60 * 60 * 1000,
      totalClickCount: 0,
      totalOpenCount: 0,
      uniqueClickCount: 0,
      uniqueOpenCount: 0,
    };

    await createComponent();
    await component.cancelScheduledAnnouncement();

    expect(convexMock.mutation).toHaveBeenCalledWith(
      api.marketing.emails.cancelAnnouncement,
      {
        eventMarketingEmailId: 'marketing1',
      },
    );
    expect(toast.success).toHaveBeenCalledWith(
      'Scheduled marketing announcement cancelled.',
    );
  });

  describe('audience scope', () => {
    it('hides the audience scope fieldset when no trust links exist', async () => {
      trustLinks = [];
      await createComponent();
      expect(await harness.hasAudienceScopeFieldset()).toBe(false);
    });

    it('shows the audience scope fieldset when trust links exist', async () => {
      trustLinks = [
        {
          direction: 'outgoing',
          trustingOrganizerId: 'org-a',
          trustedOrganizerId: 'org-b',
          trustingOrganizerName: 'Org A',
          trustedOrganizerName: 'Org B',
          trustedMemberCount: 12,
        },
      ];
      await createComponent();
      expect(await harness.hasAudienceScopeFieldset()).toBe(true);
      expect(await harness.isCommunityRadioChecked()).toBe(true);
      expect(await harness.isCommunityAndTrustedRadioChecked()).toBe(false);
    });

    it('passes community_and_trusted audienceScope to scheduleAnnouncement when selected', async () => {
      trustLinks = [
        {
          direction: 'outgoing',
          trustingOrganizerId: 'org-a',
          trustedOrganizerId: 'org-b',
          trustingOrganizerName: 'Org A',
          trustedOrganizerName: 'Org B',
          trustedMemberCount: 12,
        },
      ];
      recipientCount = {
        count: 10,
        cappedAt500: false,
        directCount: 8,
        trustLinkedCount: 2,
        totalCount: 10,
      };

      await createComponent();
      component.audienceScope.set('community_and_trusted');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await component.queueNow();

      const mutationCalls = convexMock.mutation.mock.calls as unknown[][];
      const firstCall = mutationCalls[0];
      const callArgs: unknown = firstCall?.[1];
      if (!callArgs || typeof callArgs !== 'object') {
        throw new Error('Expected scheduleAnnouncement call args');
      }
      const audienceScope: unknown = Reflect.get(callArgs, 'audienceScope');
      expect(audienceScope).toBe('community_and_trusted');
    });

    it('shows recipient breakdown when scope is community_and_trusted and trustLinkedCount > 0', async () => {
      trustLinks = [
        {
          direction: 'outgoing',
          trustingOrganizerId: 'org-a',
          trustedOrganizerId: 'org-b',
          trustingOrganizerName: 'Org A',
          trustedOrganizerName: 'Org B',
          trustedMemberCount: 12,
        },
      ];
      recipientCount = {
        count: 10,
        cappedAt500: false,
        directCount: 8,
        trustLinkedCount: 2,
        totalCount: 10,
      };

      await createComponent();
      component.audienceScope.set('community_and_trusted');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const breakdownText = await harness.getRecipientBreakdownText();
      expect(breakdownText).toContain('8 from your community');
      expect(breakdownText).toContain('2 via trusted communities');
    });

    it('does not show recipient breakdown when scope is community', async () => {
      trustLinks = [
        {
          direction: 'outgoing',
          trustingOrganizerId: 'org-a',
          trustedOrganizerId: 'org-b',
          trustingOrganizerName: 'Org A',
          trustedOrganizerName: 'Org B',
          trustedMemberCount: 12,
        },
      ];
      recipientCount = {
        count: 10,
        cappedAt500: false,
        directCount: 8,
        trustLinkedCount: 2,
        totalCount: 10,
      };

      await createComponent();
      // Default scope is 'community'
      expect(await harness.getRecipientBreakdownText()).toBeNull();
    });

    it('shows confirmation dialog when totalCount >= 50 and trustLinkedCount > 0', async () => {
      trustLinks = [
        {
          direction: 'outgoing',
          trustingOrganizerId: 'org-a',
          trustedOrganizerId: 'org-b',
          trustingOrganizerName: 'Org A',
          trustedOrganizerName: 'Org B',
          trustedMemberCount: 12,
        },
      ];
      recipientCount = {
        count: 55,
        cappedAt500: false,
        directCount: 40,
        trustLinkedCount: 15,
        totalCount: 55,
      };

      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      await createComponent();
      component.audienceScope.set('community_and_trusted');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await component.queueNow();

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining('55 people'),
      );
      expect(convexMock.mutation).toHaveBeenCalled();
    });

    it('does not schedule when confirmation dialog is dismissed', async () => {
      trustLinks = [
        {
          direction: 'outgoing',
          trustingOrganizerId: 'org-a',
          trustedOrganizerId: 'org-b',
          trustingOrganizerName: 'Org A',
          trustedOrganizerName: 'Org B',
          trustedMemberCount: 12,
        },
      ];
      recipientCount = {
        count: 55,
        cappedAt500: false,
        directCount: 40,
        trustLinkedCount: 15,
        totalCount: 55,
      };

      vi.spyOn(window, 'confirm').mockReturnValue(false);

      await createComponent();
      component.audienceScope.set('community_and_trusted');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await component.queueNow();

      expect(convexMock.mutation).not.toHaveBeenCalled();
    });

    it('skips confirmation dialog when totalCount < 50', async () => {
      trustLinks = [
        {
          direction: 'outgoing',
          trustingOrganizerId: 'org-a',
          trustedOrganizerId: 'org-b',
          trustingOrganizerName: 'Org A',
          trustedOrganizerName: 'Org B',
          trustedMemberCount: 12,
        },
      ];
      recipientCount = {
        count: 10,
        cappedAt500: false,
        directCount: 8,
        trustLinkedCount: 2,
        totalCount: 10,
      };

      const confirmSpy = vi.spyOn(window, 'confirm');

      await createComponent();
      component.audienceScope.set('community_and_trusted');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      await component.queueNow();

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(convexMock.mutation).toHaveBeenCalled();
    });
  });
});
