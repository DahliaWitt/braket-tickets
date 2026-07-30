import '../../../../../../../test-setup';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {describe, expect, it, vi} from 'vitest';
import {GuestListAssignmentsComponent} from './guest-list-assignments.component';
import {GuestListAssignmentsHarness} from './guest-list-assignments.component.harness';
import {GuestListOrganizerService} from './guest-list-organizer.service';

function makeServiceMock() {
  return {
    searchMembers: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue(undefined),
    bulkCreateStaff: vi.fn().mockResolvedValue({
      insertedCount: 1,
      skippedCount: 0,
      outcomes: [{rowIndex: 0, status: 'inserted'}],
    }),
    updateGrant: vi.fn().mockResolvedValue(undefined),
    revoke: vi.fn().mockResolvedValue(undefined),
    resendInvite: vi.fn().mockResolvedValue(undefined),
    listGuests: vi.fn().mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    }),
    listByEvent: vi.fn().mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    }),
  };
}

async function setup(
  service = makeServiceMock(),
  assignments: readonly Record<string, unknown>[] = [],
) {
  await TestBed.configureTestingModule({
    imports: [GuestListAssignmentsComponent],
    providers: [
      provideZonelessChangeDetection(),
      {provide: GuestListOrganizerService, useValue: service},
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(GuestListAssignmentsComponent);
  fixture.componentRef.setInput('eventId', 'event-1');
  fixture.componentRef.setInput('organizerId', 'organizer-1');
  fixture.componentRef.setInput('assignments', assignments);
  fixture.detectChanges();
  const harness = await TestbedHarnessEnvironment.harnessForFixture(
    fixture,
    GuestListAssignmentsHarness,
  );
  return {fixture, harness, service};
}

const activeAssignment = {
  assignmentId: 'assignment-1',
  eventId: 'event-1',
  role: 'staff',
  displayName: 'Riley Crew',
  email: 'riley@example.test',
  grantedSlots: 2,
  usedSlots: 2,
  status: 'active',
  inviteState: 'accepted',
  createdAt: 1,
};

describe('GuestListAssignmentsComponent', () => {
  it('shows event totals and each delegate usage', async () => {
    const service = makeServiceMock();
    await TestBed.configureTestingModule({
      imports: [GuestListAssignmentsComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: GuestListOrganizerService, useValue: service},
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(GuestListAssignmentsComponent);
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('organizerId', 'organizer-1');
    fixture.componentRef.setInput('overview', {
      selfServiceGuestCount: 3,
      activeGrantedSlots: 8,
      activeArtistGuestCount: 2,
      activeStaffGuestCount: 1,
      activeAssignmentCount: 2,
      totalGuestAdmissionCount: 7,
    });
    fixture.componentRef.setInput('assignments', [
      {
        assignmentId: 'assignment-1',
        eventId: 'event-1',
        role: 'artist',
        displayName: 'DJ Moth',
        email: 'moth@example.test',
        grantedSlots: 5,
        usedSlots: 2,
        status: 'active',
        inviteState: 'accepted',
        createdAt: 1,
      },
    ]);
    fixture.detectChanges();
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListAssignmentsHarness,
    );

    expect(await harness.getOverviewText()).toContain('3 self-service');
    expect(await harness.getOverviewText()).toContain('7 total admissions');
    expect((await harness.getRowTexts())[0]).toContain('DJ Moth');
    expect((await harness.getRowTexts())[0]).toContain('2 / 5 used');
  });

  it('plainly preserves redeemed guests and attribution before revoke', async () => {
    const {harness} = await setup(makeServiceMock(), [activeAssignment]);

    await harness.clickRevoke();

    expect(await harness.getRevokeWarningText()).toContain(
      '2 guest list slots have been used',
    );
    expect(await harness.getRevokeWarningText()).toContain(
      'Existing guests and tickets will remain, and source attribution will be preserved.',
    );
  });

  it('searches community members and invites the selected artist with the role default', async () => {
    const service = makeServiceMock();
    service.searchMembers.mockResolvedValue([
      {
        userId: 'user-1',
        displayName: 'Alex Artist',
        email: 'alex@example.test',
      },
    ]);
    const {harness} = await setup(service);

    await harness.searchMembers('alex');
    await harness.selectSearchResult();
    await harness.setRole('artist');
    await harness.clickInvite();

    expect(service.searchMembers).toHaveBeenCalledWith('organizer-1', 'alex');
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        role: 'artist',
        displayName: 'Alex Artist',
        email: 'alex@example.test',
        userId: 'user-1',
        grantedSlots: undefined,
      }),
    );
  });

  it('uses a semantic list of buttons for member search results', async () => {
    const service = makeServiceMock();
    service.searchMembers.mockResolvedValue([
      {
        userId: 'user-1',
        displayName: 'Alex Artist',
        email: 'alex@example.test',
      },
    ]);
    const {harness} = await setup(service);

    await harness.searchMembers('alex');

    expect(await harness.getSearchResultSemantics()).toEqual({
      listTag: 'ul',
      resultRole: null,
    });
  });

  it('drops a selected member identity when the email is changed', async () => {
    const service = makeServiceMock();
    service.searchMembers.mockResolvedValue([
      {
        userId: 'user-1',
        displayName: 'Alex Artist',
        email: 'alex@example.test',
      },
    ]);
    const {harness} = await setup(service);

    await harness.searchMembers('alex');
    await harness.selectSearchResult();
    await harness.setEmail('different@example.test');
    await harness.clickInvite();

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'different@example.test',
        userId: undefined,
      }),
    );
  });

  it('drops a selected member without an email when an address is entered', async () => {
    const service = makeServiceMock();
    service.searchMembers.mockResolvedValue([
      {
        userId: 'user-1',
        displayName: 'Alex Artist',
        email: null,
      },
    ]);
    const {harness} = await setup(service);

    await harness.searchMembers('alex');
    await harness.selectSearchResult();
    await harness.setEmail('alex@example.test');
    await harness.clickInvite();

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'alex@example.test',
        userId: undefined,
      }),
    );
  });

  it('invites an arbitrary email with a per-event slot override', async () => {
    const service = makeServiceMock();
    const {harness} = await setup(service);

    await harness.setDisplayName('Tour Manager');
    await harness.setEmail('tour@example.test');
    await harness.setRole('staff');
    await harness.setGrantOverride('4');
    await harness.clickInvite();

    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'staff',
        displayName: 'Tour Manager',
        email: 'tour@example.test',
        userId: undefined,
        grantedSlots: 4,
      }),
    );
  });

  it('explains required invite fields after an attempted submission', async () => {
    const service = makeServiceMock();
    const {harness} = await setup(service);

    await harness.clickInvite();

    expect(await harness.getIdentityErrors()).toEqual([
      'Name is required',
      'Email is required',
    ]);
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each(['abc', '-1', '1.5', '101'])(
    'blocks an invalid slot override of %s',
    async (override) => {
      const service = makeServiceMock();
      const {harness} = await setup(service);
      await harness.setDisplayName('Tour Manager');
      await harness.setEmail('tour@example.test');

      await harness.setGrantOverride(override);

      expect(await harness.getInviteState()).toEqual({
        disabled: false,
        overrideError: 'Use a whole number between 0 and 100.',
      });
      await harness.clickInvite();
      expect(service.create).not.toHaveBeenCalled();
    },
  );

  it('uses the shared import surface to bulk create staff assignments', async () => {
    const service = makeServiceMock();
    const {fixture, harness} = await setup(service);

    await harness.clickImportStaff();
    fixture.detectChanges();
    await fixture.whenStable();
    const surface = await harness.getImportSurface();
    expect(surface).not.toBeNull();
    await surface!.pasteText(
      'name\temail\tslots\nStage Hand\tstage@example.test\t3',
    );
    await surface!.clickNext();
    await surface!.clickConfirm();

    expect(service.bulkCreateStaff).toHaveBeenCalledWith(
      'event-1',
      expect.any(String),
      [{name: 'Stage Hand', email: 'stage@example.test', slotOverride: 3}],
    );
  });

  it('warns before reducing a grant below redeemed usage', async () => {
    const service = makeServiceMock();
    const {harness} = await setup(service, [activeAssignment]);

    await harness.clickEditGrant();
    await harness.setEditedGrant('1');
    await harness.clickSaveGrant();

    expect(service.updateGrant).not.toHaveBeenCalled();
    expect(await harness.getGrantWarningText()).toContain(
      '2 slots are already used. Existing guests and tickets will remain, and source attribution will be preserved.',
    );
    expect(await harness.getGrantWarningText()).toContain(
      'New additions stay blocked until usage falls below 1.',
    );
    await harness.clickConfirmGrantReduction();
    expect(service.updateGrant).toHaveBeenCalledWith('assignment-1', 1);
  });

  it('uses an inline dialog, focuses the safe action, and restores the trigger on Escape', async () => {
    const {fixture, harness} = await setup(makeServiceMock(), [
      activeAssignment,
    ]);

    await harness.clickEditGrant();
    await harness.setEditedGrant('1');
    await harness.clickSaveGrant();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getGrantWarningRole()).toBe('dialog');
    expect(await harness.isCancelGrantFocused(), 'cancel action focus').toBe(
      true,
    );

    await harness.dismissGrantWarningWithEscape();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.getGrantWarningRole()).toBeNull();

    await harness.clickSaveGrant();
    fixture.detectChanges();
    await fixture.whenStable();
    await harness.clickCancelGrantReduction();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSaveGrantFocused(), 'trigger focus restored').toBe(
      true,
    );
  });

  it('locks grant confirmation while saving and restores focus after a successful reduction', async () => {
    const service = makeServiceMock();
    let resolveUpdate!: () => void;
    service.updateGrant.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const {fixture, harness} = await setup(service, [activeAssignment]);

    await harness.clickEditGrant();
    await harness.setEditedGrant('1');
    await harness.clickSaveGrant();
    const confirmation = harness.clickConfirmGrantReduction();
    await fixture.whenStable();

    expect(await harness.getGrantConfirmationState()).toEqual({
      confirmDisabled: true,
      confirmBusy: true,
      cancelDisabled: true,
    });

    resolveUpdate();
    await confirmation;
    await fixture.whenStable();

    expect(await harness.isRowFocused()).toBe(true);
  });

  it('restores focus to the assignment row after a successful grant update', async () => {
    const {fixture, harness} = await setup(makeServiceMock(), [
      activeAssignment,
    ]);

    await harness.clickEditGrant();
    await harness.setEditedGrant('3');
    await harness.clickSaveGrant();
    await fixture.whenStable();

    expect(await harness.isRowFocused()).toBe(true);
  });

  it('locks revoke confirmation while saving and restores focus after a successful revoke', async () => {
    const service = makeServiceMock();
    let resolveRevoke!: () => void;
    service.revoke.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRevoke = resolve;
      }),
    );
    const {fixture, harness} = await setup(service, [activeAssignment]);

    await harness.clickRevoke();
    const confirmation = harness.clickConfirmRevoke();
    await fixture.whenStable();

    expect(await harness.getRevokeConfirmationState()).toEqual({
      confirmDisabled: true,
      confirmBusy: true,
      cancelDisabled: true,
    });

    resolveRevoke();
    await confirmation;
    await fixture.whenStable();

    expect(await harness.isRowFocused()).toBe(true);
  });

  it('loads and displays sourced guests when a row expands', async () => {
    const service = makeServiceMock();
    service.listGuests.mockResolvedValue({
      page: [
        {
          guestId: 'guest-1',
          name: 'Guest One',
          email: 'guest@example.test',
          emailedAt: 1,
        },
      ],
      isDone: true,
      continueCursor: '',
    });
    const {harness} = await setup(service, [activeAssignment]);

    await harness.clickExpandGuests();

    expect(service.listGuests).toHaveBeenCalledWith('assignment-1', null);
    expect((await harness.getSourcedGuestTexts())[0]).toContain('Guest One');
  });

  it('refreshes an expanded guest list when its used-slot count changes', async () => {
    const service = makeServiceMock();
    service.listGuests
      .mockResolvedValueOnce({
        page: [
          {
            guestId: 'guest-1',
            name: 'Guest One',
            email: 'one@example.test',
            deliveryState: 'sent',
          },
        ],
        isDone: true,
        continueCursor: '',
      })
      .mockResolvedValueOnce({
        page: [
          {
            guestId: 'guest-2',
            name: 'Guest Two',
            email: 'two@example.test',
            deliveryState: 'queued',
          },
        ],
        isDone: true,
        continueCursor: '',
      });
    const {fixture, harness} = await setup(service, [activeAssignment]);
    await harness.clickExpandGuests();

    fixture.componentRef.setInput('assignments', [
      {...activeAssignment, usedSlots: 3},
    ]);
    await fixture.whenStable();

    expect(service.listGuests).toHaveBeenCalledTimes(2);
    expect(await harness.getSourcedGuestTexts()).toEqual([
      expect.stringContaining('Guest Two'),
    ]);
  });

  it('attempts a failed usage refresh once and lets the organizer retry', async () => {
    const service = makeServiceMock();
    service.listGuests
      .mockResolvedValueOnce({
        page: [
          {
            guestId: 'guest-1',
            name: 'Guest One',
            email: 'one@example.test',
            deliveryState: 'sent',
          },
        ],
        isDone: true,
        continueCursor: '',
      })
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        page: [
          {
            guestId: 'guest-2',
            name: 'Guest Two',
            email: 'two@example.test',
            deliveryState: 'sent',
          },
        ],
        isDone: true,
        continueCursor: '',
      });
    const {fixture, harness} = await setup(service, [activeAssignment]);
    await harness.clickExpandGuests();

    fixture.componentRef.setInput('assignments', [
      {...activeAssignment, usedSlots: 3},
    ]);
    await fixture.whenStable();
    await Promise.resolve();
    await fixture.whenStable();

    expect(service.listGuests).toHaveBeenCalledTimes(2);
    expect(await harness.hasSourcedGuestRetry()).toBe(true);

    await harness.clickRetrySourcedGuests();

    expect(service.listGuests).toHaveBeenCalledTimes(3);
    expect(await harness.hasSourcedGuestRetry()).toBe(false);
    expect(await harness.getSourcedGuestTexts()).toEqual([
      expect.stringContaining('Guest Two'),
    ]);
  });

  it('refetches when usage changes before an in-flight guest page resolves', async () => {
    const service = makeServiceMock();
    let resolveStale!: (value: {
      page: Record<string, unknown>[];
      isDone: boolean;
      continueCursor: string;
    }) => void;
    service.listGuests
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
      )
      .mockResolvedValueOnce({
        page: [
          {
            guestId: 'guest-fresh',
            name: 'Fresh Guest',
            email: 'fresh@example.test',
            deliveryState: 'sent',
          },
        ],
        isDone: true,
        continueCursor: '',
      });
    const {fixture, harness} = await setup(service, [activeAssignment]);

    const expansion = harness.clickExpandGuests();
    await vi.waitFor(() => {
      expect(service.listGuests).toHaveBeenCalledTimes(1);
    });
    fixture.componentRef.setInput('assignments', [
      {...activeAssignment, usedSlots: 3},
    ]);
    await fixture.whenStable();
    resolveStale({
      page: [
        {
          guestId: 'guest-stale',
          name: 'Stale Guest',
          email: 'stale@example.test',
          deliveryState: 'sent',
        },
      ],
      isDone: true,
      continueCursor: '',
    });
    await expansion;
    await fixture.whenStable();

    expect(service.listGuests).toHaveBeenCalledTimes(2);
    expect(await harness.getSourcedGuestTexts()).toEqual([
      expect.stringContaining('Fresh Guest'),
    ]);
  });

  it('paginates sourced guests beyond the first page', async () => {
    const service = makeServiceMock();
    service.listGuests
      .mockResolvedValueOnce({
        page: [
          {
            guestId: 'guest-1',
            name: 'Guest One',
            email: 'one@example.test',
            deliveryState: 'sent',
          },
        ],
        isDone: false,
        continueCursor: 'guest-page-2',
      })
      .mockResolvedValueOnce({
        page: [
          {
            guestId: 'guest-2',
            name: 'Guest Two',
            email: 'two@example.test',
            deliveryState: 'sent',
          },
        ],
        isDone: true,
        continueCursor: '',
      });
    const {harness} = await setup(service, [activeAssignment]);

    await harness.clickExpandGuests();
    expect(await harness.hasSourcedGuestLoadMore()).toBe(true);
    await harness.clickLoadMoreSourcedGuests();

    expect(service.listGuests).toHaveBeenNthCalledWith(
      2,
      'assignment-1',
      'guest-page-2',
    );
    expect(await harness.getSourcedGuestTexts()).toHaveLength(2);
    expect(await harness.hasSourcedGuestLoadMore()).toBe(false);
  });

  it('prevents duplicate sourced-guest loads and exposes a recoverable error', async () => {
    const service = makeServiceMock();
    let rejectLoad!: (error: Error) => void;
    service.listGuests.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
    );
    const {fixture, harness} = await setup(service, [activeAssignment]);

    const firstLoad = harness.clickExpandGuests();
    await harness.clickExpandGuests();
    expect(service.listGuests).toHaveBeenCalledTimes(1);
    rejectLoad(new Error('network down'));
    await firstLoad;
    fixture.detectChanges();

    expect(await harness.getActionErrorText()).toContain(
      "couldn't load this guest list",
    );
  });

  it('prevents duplicate grant updates and shows an action error', async () => {
    const service = makeServiceMock();
    let rejectUpdate!: (error: Error) => void;
    service.updateGrant.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    const {fixture, harness} = await setup(service, [activeAssignment]);

    await harness.clickEditGrant();
    await harness.setEditedGrant('3');
    const firstSave = harness.clickSaveGrant();
    await harness.clickSaveGrant();
    expect(service.updateGrant).toHaveBeenCalledTimes(1);
    rejectUpdate(new Error('network down'));
    await firstSave;
    fixture.detectChanges();

    expect(await harness.getActionErrorText()).toContain(
      "couldn't update this grant",
    );
  });

  it('shows invite state and appends another assignment page', async () => {
    const service = makeServiceMock();
    service.listByEvent.mockResolvedValue({
      page: [
        {
          ...activeAssignment,
          assignmentId: 'assignment-2',
          displayName: 'Second Staff',
          inviteState: 'pending',
        },
      ],
      isDone: true,
      continueCursor: '',
    });
    const {fixture, harness} = await setup(service, [activeAssignment]);
    fixture.componentRef.setInput('continueCursor', 'next-page');
    fixture.detectChanges();

    expect((await harness.getRowTexts())[0]).toContain('accepted');
    await harness.clickLoadMore();

    expect(service.listByEvent).toHaveBeenCalledWith('event-1', 'next-page');
    expect(
      (await harness.getRowTexts()).some((text) =>
        text.includes('Second Staff'),
      ),
    ).toBe(true);
    expect(await harness.hasLoadMore()).toBe(false);
  });

  it('resets static later pages when the reactive first-page boundary changes', async () => {
    const service = makeServiceMock();
    service.listByEvent.mockResolvedValue({
      page: [
        {
          ...activeAssignment,
          assignmentId: 'assignment-2',
          displayName: 'Second Staff',
        },
      ],
      isDone: true,
      continueCursor: '',
    });
    const {fixture, harness} = await setup(service, [activeAssignment]);
    fixture.componentRef.setInput('continueCursor', 'old-boundary');
    await fixture.whenStable();
    await harness.clickLoadMore();
    expect(await harness.getRowTexts()).toHaveLength(2);

    fixture.componentRef.setInput('assignments', [
      {
        ...activeAssignment,
        assignmentId: 'assignment-new',
        displayName: 'Newest Artist',
      },
    ]);
    fixture.componentRef.setInput('continueCursor', 'new-boundary');
    await fixture.whenStable();

    expect(await harness.getRowTexts()).toHaveLength(1);
    expect((await harness.getRowTexts())[0]).toContain('Newest Artist');
    expect(await harness.hasLoadMore()).toBe(true);
  });

  it('discards an in-flight assignment page after its first-page boundary changes', async () => {
    const service = makeServiceMock();
    let resolveStale!: (value: {
      page: (typeof activeAssignment)[];
      isDone: boolean;
      continueCursor: string;
    }) => void;
    service.listByEvent
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
      )
      .mockResolvedValueOnce({
        page: [
          {
            ...activeAssignment,
            assignmentId: 'assignment-fresh',
            displayName: 'Fresh Staff',
          },
        ],
        isDone: true,
        continueCursor: '',
      });
    const {fixture, harness} = await setup(service, [activeAssignment]);
    fixture.componentRef.setInput('continueCursor', 'old-boundary');
    await fixture.whenStable();

    const staleLoad = harness.clickLoadMore();
    await vi.waitFor(() => {
      expect(service.listByEvent).toHaveBeenCalledWith(
        'event-1',
        'old-boundary',
      );
    });
    fixture.componentRef.setInput('assignments', [
      {
        ...activeAssignment,
        assignmentId: 'assignment-new',
        displayName: 'Newest Artist',
      },
    ]);
    fixture.componentRef.setInput('continueCursor', 'new-boundary');
    await fixture.whenStable();
    await harness.clickLoadMore();

    resolveStale({
      page: [
        {
          ...activeAssignment,
          assignmentId: 'assignment-stale',
          displayName: 'Stale Staff',
        },
      ],
      isDone: true,
      continueCursor: '',
    });
    await staleLoad;
    await fixture.whenStable();

    const rows = await harness.getRowTexts();
    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.includes('Fresh Staff'))).toBe(true);
    expect(rows.some((row) => row.includes('Stale Staff'))).toBe(false);
  });

  it('offers pagination when a backend page has no visible assignments', async () => {
    const service = makeServiceMock();
    service.listByEvent.mockResolvedValue({
      page: [activeAssignment],
      isDone: true,
      continueCursor: '',
    });
    const {fixture, harness} = await setup(service);
    fixture.componentRef.setInput('continueCursor', 'hidden-page');
    await fixture.whenStable();

    expect(await harness.getRowTexts()).toEqual([]);
    expect(await harness.hasLoadMore()).toBe(true);

    await harness.clickLoadMore();

    expect(service.listByEvent).toHaveBeenCalledWith('event-1', 'hidden-page');
    expect(await harness.getRowTexts()).toHaveLength(1);
  });
});
