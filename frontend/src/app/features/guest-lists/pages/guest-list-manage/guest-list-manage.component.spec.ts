import '../../../../../test-setup';
import {TestBed, type ComponentFixture} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {ActivatedRoute, provideRouter} from '@angular/router';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {logger} from '@/utils/logger';
import {
  GuestListDelegateService,
  type GuestListGuestId,
} from '../../services/guest-list-delegate.service';
import {GuestListAssignmentTokenStoreService} from '../../services/guest-list-assignment-token-store.service';
import {GuestListManageComponent} from './guest-list-manage.component';
import {GuestListManageComponentHarness} from './guest-list-manage.component.harness';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

const availableView = {
  status: 'available' as const,
  assignment: {
    assignmentId: 'assignment-1',
    eventId: 'event-1',
    role: 'artist' as const,
    displayName: 'Nova',
    email: 'nova@example.com',
    grantedSlots: 2,
    usedSlots: 1,
    status: 'active' as const,
    inviteState: 'accepted' as const,
    createdAt: 1,
  },
  event: {
    title: 'Warehouse Signal',
    date: '2026-08-01',
    endDate: '2026-08-01T10:00:00.000Z',
    location: 'Dock 9',
  },
  guests: {
    page: [
      {
        guestId: 'guest-1',
        name: 'Rae',
        email: 'rae@example.com',
        deliveryState: 'failed' as const,
      },
    ],
    isDone: true,
    continueCursor: '',
  },
};

describe('GuestListManageComponent', () => {
  const delegate = {
    authorizeToken: vi.fn(),
    claimSignedIn: vi.fn(),
    getView: vi.fn(),
    addGuest: vi.fn(),
    updateGuest: vi.fn(),
    removeGuest: vi.fn(),
    retryTicket: vi.fn(),
  };
  const tokens = {
    captureCredentialFromFragment: vi.fn(),
    getMostRecent: vi.fn(),
    rememberResolvedAssignment: vi.fn(),
    forget: vi.fn(),
  };
  let fixture: ComponentFixture<GuestListManageComponent>;
  let harness: GuestListManageComponentHarness;

  async function create(assignmentId: string | null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [GuestListManageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {snapshot: {paramMap: {get: () => assignmentId}}},
        },
        {provide: GuestListDelegateService, useValue: delegate},
        {provide: GuestListAssignmentTokenStoreService, useValue: tokens},
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(GuestListManageComponent);
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      GuestListManageComponentHarness,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    delegate.getView.mockResolvedValue(availableView);
    delegate.authorizeToken.mockResolvedValue({status: 'available'});
    delegate.claimSignedIn.mockResolvedValue({status: 'available'});
    delegate.addGuest.mockResolvedValue({
      guest: {
        guestId: 'guest-2',
        name: 'Mika',
        email: 'mika@example.com',
        deliveryState: 'queued',
      },
      usedSlots: 2,
      grantedSlots: 2,
    });
    delegate.updateGuest.mockResolvedValue({
      guest: {
        guestId: 'guest-1',
        name: 'Rae Updated',
        email: 'rae-updated@example.com',
        deliveryState: 'queued',
      },
      usedSlots: 1,
      grantedSlots: 2,
    });
    delegate.removeGuest.mockResolvedValue({removed: true, usedSlots: 0});
    delegate.retryTicket.mockResolvedValue({status: 'queued'});
    tokens.captureCredentialFromFragment.mockReturnValue(null);
    tokens.getMostRecent.mockReturnValue(null);
  });

  it.each(['claimSignedIn', 'authorizeToken', 'getView'] as const)(
    'shows a retryable neutral failure when %s rejects',
    async (operation) => {
      if (operation === 'authorizeToken') {
        tokens.captureCredentialFromFragment.mockReturnValue('invite-secret');
      }
      delegate[operation].mockRejectedValueOnce(new Error('network down'));
      await create(operation === 'authorizeToken' ? null : 'assignment-1');
      await fixture.whenStable();

      expect(await harness.getLoadFailureText()).toContain('try again');
      expect(await harness.hasEventDetails()).toBe(false);
      expect(await harness.getUnavailableText()).toBeNull();

      await harness.retryLoading();
      await fixture.whenStable();
      expect(await harness.hasEventDetails()).toBe(true);
    },
  );

  it('reveals no event information until accountless token resolution succeeds', async () => {
    let resolve!: (value: typeof availableView) => void;
    delegate.getView.mockReturnValue(new Promise((done) => (resolve = done)));
    tokens.captureCredentialFromFragment.mockReturnValue('invite-secret');
    await create(null);

    expect(await harness.hasEventDetails()).toBe(false);
    resolve(availableView);
    await fixture.whenStable();

    expect(await harness.hasEventDetails()).toBe(true);
    expect(tokens.rememberResolvedAssignment).toHaveBeenCalledWith(
      'assignment-1',
      'invite-secret',
    );
  });

  it('scrubs the fragment before authorizing and subscribes only after authorization', async () => {
    const calls: string[] = [];
    tokens.captureCredentialFromFragment.mockImplementation(() => {
      calls.push('scrub');
      return 'invite-secret';
    });
    delegate.authorizeToken.mockImplementation(() => {
      calls.push('authorize');
      return Promise.resolve({status: 'available'});
    });
    delegate.getView.mockImplementation(() => {
      calls.push('subscribe');
      return Promise.resolve(availableView);
    });
    await create(null);
    await fixture.whenStable();

    expect(calls).toEqual(['scrub', 'authorize', 'subscribe']);
  });

  it('uses signed-in assignment access for the authenticated route', async () => {
    await create('assignment-1');
    await fixture.whenStable();

    expect(delegate.claimSignedIn).toHaveBeenCalledWith('assignment-1');
    expect(delegate.getView).toHaveBeenCalledWith({
      kind: 'signedIn',
      assignmentId: 'assignment-1',
    });
    expect(await harness.getUsageText()).toContain('1 of 2');
  });

  it('renders full event timestamps as event-local dates and times', async () => {
    delegate.getView.mockResolvedValue({
      ...availableView,
      event: {
        ...availableView.event,
        date: '2026-08-02T04:00:00.000Z',
        endDate: '2026-08-02T10:00:00.000Z',
      },
    });

    await create('assignment-1');

    const text = await harness.getEventDetailsText();
    expect(text).toContain('Aug 1, 2026');
    expect(text).toContain('9:00 PM – 3:00 AM');
    expect(text).not.toContain('2026-08-02T04:00:00.000Z');
  });

  it('does not subscribe or reveal details when token authorization is unavailable', async () => {
    tokens.captureCredentialFromFragment.mockReturnValue('bad-secret');
    delegate.authorizeToken.mockResolvedValue({status: 'unavailable'});
    await create(null);
    await fixture.whenStable();

    expect(delegate.getView).not.toHaveBeenCalled();
    expect(await harness.getUnavailableText()).toContain('unavailable');
    expect(await harness.hasEventDetails()).toBe(false);
  });

  it('does not subscribe when the signed-in assignment claim is unavailable', async () => {
    delegate.claimSignedIn.mockResolvedValue({status: 'unavailable'});
    await create('assignment-1');
    await fixture.whenStable();

    expect(delegate.getView).not.toHaveBeenCalled();
    expect(await harness.getUnavailableText()).toContain('unavailable');
  });

  it('shows one neutral state and clears a rejected stored credential', async () => {
    tokens.captureCredentialFromFragment.mockReturnValue('bad-secret');
    delegate.getView.mockResolvedValue({status: 'unavailable'});
    await create(null);
    await fixture.whenStable();

    expect(await harness.getUnavailableText()).toContain('unavailable');
    expect(await harness.hasEventDetails()).toBe(false);
  });

  it('clears a persisted credential when the server reports it unavailable', async () => {
    tokens.getMostRecent.mockReturnValue({
      assignmentId: 'assignment-1',
      token: 'stored-secret',
    });
    delegate.getView.mockResolvedValue({status: 'unavailable'});
    await create(null);
    await fixture.whenStable();

    expect(tokens.forget).toHaveBeenCalledWith('assignment-1');
  });

  it('disables additions at quota while leaving removal available', async () => {
    delegate.getView.mockResolvedValue({
      ...availableView,
      assignment: {...availableView.assignment, usedSlots: 2},
    });
    await create('assignment-1');
    await fixture.whenStable();

    expect(await harness.isAddDisabled()).toBe(true);
    await harness.clickRemove();
    expect(delegate.removeGuest).toHaveBeenCalled();
  });

  it('confirms removal, explains the ticket consequence, and restores trigger focus on cancel', async () => {
    await create('assignment-1');

    await harness.openRemovalConfirmation();

    expect(await harness.getRemovalConfirmationText()).toContain('Remove Rae?');
    expect(await harness.getRemovalConfirmationText()).toContain(
      'Their ticket stops working immediately.',
    );
    expect(await harness.isCancelRemovalFocused()).toBe(true);
    expect(delegate.removeGuest).not.toHaveBeenCalled();

    await harness.cancelRemoval();

    expect(await harness.getRemovalConfirmationText()).toBeNull();
    expect(await harness.isRemoveFocused()).toBe(true);
    expect(delegate.removeGuest).not.toHaveBeenCalled();
  });

  it('locks removal confirmation and the add form while removal is pending', async () => {
    const removal = deferred<{removed: true; usedSlots: number}>();
    delegate.removeGuest.mockReturnValueOnce(removal.promise);
    await create('assignment-1');
    await harness.fillGuest('Mika', 'mika@example.com');

    await harness.openRemovalConfirmation();
    await harness.confirmRemoval();

    expect(await harness.getRemovalConfirmationState()).toEqual({
      confirmDisabled: true,
      confirmBusy: true,
      cancelDisabled: true,
    });
    expect(await harness.isAddDisabled()).toBe(true);

    await harness.submitGuest();
    expect(delegate.addGuest).not.toHaveBeenCalled();

    removal.resolve({removed: true, usedSlots: 0});
    await vi.waitFor(async () =>
      expect(await harness.getRemovalConfirmationText()).toBeNull(),
    );

    expect(await harness.isGuestListHeadingFocused()).toBe(true);
  });

  it('cancels an edit when that guest is removed', async () => {
    const removal = deferred<{removed: true; usedSlots: number}>();
    delegate.removeGuest.mockReturnValueOnce(removal.promise);
    delegate.getView
      .mockResolvedValueOnce(availableView)
      .mockResolvedValueOnce({
        ...availableView,
        assignment: {...availableView.assignment, usedSlots: 0},
        guests: {...availableView.guests, page: []},
      });
    await create('assignment-1');
    await harness.clickEdit();

    expect(await harness.isEditing()).toBe(true);
    expect(await harness.getGuestFormValues()).toEqual({
      name: 'Rae',
      email: 'rae@example.com',
    });

    await harness.clickRemove();
    await harness.submitGuest();

    expect(delegate.updateGuest).not.toHaveBeenCalled();

    removal.resolve({removed: true, usedSlots: 0});
    await vi.waitFor(() =>
      expect(fixture.componentInstance.editingGuestId()).toBeNull(),
    );

    expect(await harness.isEditing()).toBe(false);
    expect(await harness.getGuestFormValues()).toEqual({name: '', email: ''});
  });

  it('locks row actions while an add is pending', async () => {
    const addition = deferred<{
      guest: {
        guestId: string;
        name: string;
        email: string;
        deliveryState: 'queued';
      };
      usedSlots: number;
      grantedSlots: number;
    }>();
    delegate.addGuest.mockReturnValueOnce(addition.promise);
    await create('assignment-1');
    await harness.fillGuest('Mika', 'mika@example.com');

    await harness.submitGuest();
    await vi.waitFor(() => expect(delegate.addGuest).toHaveBeenCalledOnce());

    expect(await harness.getEditState()).toEqual({
      disabled: true,
      text: 'Edit',
    });
    expect(await harness.getRemoveState()).toEqual({
      disabled: true,
      text: 'Remove',
    });
    expect(await harness.getRetryState()).toEqual({
      disabled: true,
      text: 'Retry email',
    });

    await harness.openRemovalConfirmation();
    expect(await harness.getRemovalConfirmationText()).toBeNull();
    expect(delegate.removeGuest).not.toHaveBeenCalled();

    addition.resolve({
      guest: {
        guestId: 'guest-2',
        name: 'Mika',
        email: 'mika@example.com',
        deliveryState: 'queued',
      },
      usedSlots: 2,
      grantedSlots: 2,
    });
    await fixture.whenStable();
  });

  it('locks every row action while an edit save is pending', async () => {
    const update = deferred<{
      guest: {
        guestId: string;
        name: string;
        email: string;
        deliveryState: 'queued';
      };
      usedSlots: number;
      grantedSlots: number;
    }>();
    delegate.updateGuest.mockReturnValueOnce(update.promise);
    await create('assignment-1');
    await harness.clickEdit();

    await harness.submitGuest();
    await vi.waitFor(() => expect(delegate.updateGuest).toHaveBeenCalledOnce());

    expect(await harness.getEditState()).toEqual({
      disabled: true,
      text: 'Edit',
    });
    expect(await harness.getRemoveState()).toEqual({
      disabled: true,
      text: 'Remove',
    });
    expect(await harness.getRetryState()).toEqual({
      disabled: true,
      text: 'Retry email',
    });

    update.resolve({
      guest: {
        guestId: 'guest-1',
        name: 'Rae Updated',
        email: 'rae-updated@example.com',
        deliveryState: 'queued',
      },
      usedSlots: 1,
      grantedSlots: 2,
    });
    await vi.waitFor(() =>
      expect(fixture.componentInstance.saving()).toBe(false),
    );
  });

  it('requires name and email, then adds a guest through the delegate contract', async () => {
    await create('assignment-1');
    await fixture.whenStable();
    await harness.fillGuest('Mika', 'mika@example.com');
    await harness.submitGuest();

    expect(delegate.addGuest).toHaveBeenCalledWith(
      {kind: 'signedIn', assignmentId: 'assignment-1'},
      expect.objectContaining({name: 'Mika', email: 'mika@example.com'}),
    );
  });

  it('explains invalid guest fields after an attempted submission', async () => {
    await create('assignment-1');
    await fixture.whenStable();

    await harness.submitGuest();

    expect(await harness.getGuestFormErrors()).toEqual([
      'Name is required',
      'Email is required',
    ]);
    expect(delegate.addGuest).not.toHaveBeenCalled();
  });

  it('keeps guest details and shows an actionable error when adding fails', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    delegate.addGuest.mockRejectedValueOnce(new Error('offline'));
    await create('assignment-1');
    await fixture.whenStable();
    await harness.fillGuest('Mika', 'mika@example.com');
    await harness.submitGuest();

    expect(await harness.getActionErrorText()).toContain('not added');
    expect(await harness.getGuestFormValues()).toEqual({
      name: 'Mika',
      email: 'mika@example.com',
    });
    expect(log).toHaveBeenCalled();
  });

  it('keeps edited guest details when saving changes fails', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    delegate.updateGuest.mockRejectedValueOnce(new Error('offline'));
    await create('assignment-1');
    await fixture.whenStable();
    await harness.clickEdit();

    expect(await harness.getGuestFormValues()).toEqual({
      name: 'Rae',
      email: 'rae@example.com',
    });
    await harness.submitGuest();

    expect(await harness.getActionErrorText()).toContain('not saved');
    expect(await harness.getGuestFormValues()).toEqual({
      name: 'Rae',
      email: 'rae@example.com',
    });
    expect(log).toHaveBeenCalled();
  });

  it('keeps an added guest successful when the follow-up refresh fails', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    delegate.getView
      .mockResolvedValueOnce(availableView)
      .mockRejectedValueOnce(new Error('refresh offline'));
    await create('assignment-1');
    await harness.fillGuest('Mika', 'mika@example.com');

    await harness.submitGuest();

    expect(delegate.addGuest).toHaveBeenCalledOnce();
    expect(await harness.getActionErrorText()).toBeNull();
    expect(await harness.getActionNoticeText()).toContain('went through');
    expect(await harness.getGuestRows()).toHaveLength(2);
    expect(await harness.getUsageText()).toContain('2 of 2');
    expect(log).toHaveBeenCalled();
  });

  it('keeps an edited guest successful when the follow-up refresh fails', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    delegate.getView
      .mockResolvedValueOnce(availableView)
      .mockRejectedValueOnce(new Error('refresh offline'));
    await create('assignment-1');
    await harness.clickEdit();

    await harness.submitGuest();

    expect(delegate.updateGuest).toHaveBeenCalledOnce();
    expect(await harness.getActionErrorText()).toBeNull();
    expect(await harness.getActionNoticeText()).toContain('went through');
    expect((await harness.getGuestRows())[0]).toContain('Rae Updated');
    expect(log).toHaveBeenCalled();
  });

  it('keeps a removed guest successful when the follow-up refresh fails', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    delegate.getView
      .mockResolvedValueOnce(availableView)
      .mockRejectedValueOnce(new Error('refresh offline'));
    await create('assignment-1');

    await harness.clickRemove();

    expect(delegate.removeGuest).toHaveBeenCalledOnce();
    expect(await harness.getActionErrorText()).toBeNull();
    expect(await harness.getActionNoticeText()).toContain('went through');
    expect(await harness.getGuestRows()).toHaveLength(0);
    expect(await harness.getUsageText()).toContain('0 of 2');
    expect(log).toHaveBeenCalled();
  });

  it('keeps a queued ticket retry successful when the follow-up refresh fails', async () => {
    const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    delegate.getView
      .mockResolvedValueOnce(availableView)
      .mockRejectedValueOnce(new Error('refresh offline'));
    await create('assignment-1');

    await harness.clickRetry();

    expect(delegate.retryTicket).toHaveBeenCalledOnce();
    expect(await harness.getActionErrorText()).toBeNull();
    expect(await harness.getActionNoticeText()).toContain('went through');
    expect((await harness.getGuestRows())[0]).toContain('queued');
    expect(log).toHaveBeenCalled();
  });

  it.each([
    ['removeGuest', 'clickRemove', 'not removed'],
    ['retryTicket', 'clickRetry', 'could not resend'],
  ] as const)(
    'logs and explains a failed %s operation',
    async (operation, interaction, message) => {
      const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      delegate[operation].mockRejectedValueOnce(new Error('offline'));
      await create('assignment-1');
      await fixture.whenStable();

      await harness[interaction]();

      expect(await harness.getActionErrorText()).toContain(message);
      expect(log).toHaveBeenCalled();
      expect(await harness.getGuestRows()).toHaveLength(1);
    },
  );

  it('ignores an older reload that resolves after a newer guest action', async () => {
    await create('assignment-1');
    await fixture.whenStable();
    let resolveOlder!: (value: typeof availableView) => void;
    delegate.getView
      .mockImplementationOnce(
        () =>
          new Promise<typeof availableView>((resolve) => {
            resolveOlder = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...availableView,
        assignment: {...availableView.assignment, usedSlots: 0},
        guests: {...availableView.guests, page: []},
      });

    const olderAction = fixture.componentInstance.remove(
      'guest-1' as GuestListGuestId,
    );
    const newerAction = fixture.componentInstance.remove(
      'guest-2' as GuestListGuestId,
    );
    await vi.waitFor(() => expect(delegate.getView).toHaveBeenCalledTimes(3));
    await newerAction;
    resolveOlder(availableView);
    await olderAction;

    expect(fixture.componentInstance.view()?.assignment.usedSlots).toBe(0);
    expect(fixture.componentInstance.view()?.guests.page).toEqual([]);
  });

  it('ignores an older refresh failure after a newer guest action refreshes', async () => {
    await create('assignment-1');
    const olderRefresh = deferred<typeof availableView>();
    delegate.getView
      .mockReturnValueOnce(olderRefresh.promise)
      .mockResolvedValueOnce({
        ...availableView,
        assignment: {...availableView.assignment, usedSlots: 0},
        guests: {...availableView.guests, page: []},
      });

    const olderAction = fixture.componentInstance.remove(
      'guest-1' as GuestListGuestId,
    );
    const newerAction = fixture.componentInstance.remove(
      'guest-2' as GuestListGuestId,
    );
    await vi.waitFor(() => expect(delegate.getView).toHaveBeenCalledTimes(3));
    await newerAction;
    olderRefresh.reject(new Error('stale refresh failed'));
    await olderAction;

    expect(await harness.getActionErrorText()).toBeNull();
    expect(await harness.getActionNoticeText()).toBeNull();
    expect(fixture.componentInstance.view()?.guests.page).toEqual([]);
  });

  it.each([
    [
      'removeGuest',
      'clickRemove',
      'getRemoveState',
      'Removing…',
      'not removed',
    ],
    [
      'retryTicket',
      'clickRetry',
      'getRetryState',
      'Retrying…',
      'could not resend',
    ],
  ] as const)(
    'locks and recovers the per-row %s action',
    async (operation, interaction, getState, loadingText, errorText) => {
      const log = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      let rejectOperation!: (reason: Error) => void;
      delegate[operation]
        .mockImplementationOnce(
          () =>
            new Promise((_resolve, reject) => {
              rejectOperation = reject;
            }),
        )
        .mockResolvedValueOnce(
          operation === 'removeGuest'
            ? {removed: true, usedSlots: 0}
            : {status: 'queued'},
        );
      await create('assignment-1');
      await fixture.whenStable();

      await harness[interaction]();
      await harness[interaction]();

      expect(delegate[operation]).toHaveBeenCalledTimes(1);
      expect(await harness[getState]()).toEqual({
        disabled: true,
        text: loadingText,
      });

      rejectOperation(new Error('offline'));
      await fixture.whenStable();

      expect(await harness[getState]()).toEqual({
        disabled: false,
        text: operation === 'removeGuest' ? 'Remove' : 'Retry email',
      });
      expect(await harness.getActionErrorText()).toContain(errorText);
      expect(log).toHaveBeenCalled();

      await harness[interaction]();
      await fixture.whenStable();
      expect(delegate[operation]).toHaveBeenCalledTimes(2);
    },
  );

  it('appends additional guest pages and hides Load more at the end', async () => {
    delegate.getView
      .mockResolvedValueOnce({
        ...availableView,
        guests: {
          ...availableView.guests,
          isDone: false,
          continueCursor: 'guest-page-2',
        },
      })
      .mockResolvedValueOnce({
        ...availableView,
        guests: {
          page: [
            {
              guestId: 'guest-2',
              name: 'Sol',
              email: 'sol@example.com',
              deliveryState: 'sent' as const,
            },
          ],
          isDone: true,
          continueCursor: '',
        },
      });
    await create('assignment-1');
    await fixture.whenStable();

    expect(await harness.hasLoadMoreGuests()).toBe(true);
    await harness.loadMoreGuests();

    expect(delegate.getView).toHaveBeenLastCalledWith(
      {kind: 'signedIn', assignmentId: 'assignment-1'},
      'guest-page-2',
    );
    expect(await harness.getGuestRows()).toHaveLength(2);
    expect(await harness.hasLoadMoreGuests()).toBe(false);
  });

  it('offers ticket retry without discarding a failed admission', async () => {
    await create('assignment-1');
    await fixture.whenStable();

    expect((await harness.getGuestRows())[0]).toContain('Ticket email failed');
    await harness.clickRetry();
    expect(delegate.retryTicket).toHaveBeenCalled();
  });

  it('forgets accountless access on request', async () => {
    tokens.captureCredentialFromFragment.mockReturnValue('invite-secret');
    await create(null);
    await fixture.whenStable();

    await harness.clickForget();
    expect(tokens.forget).toHaveBeenCalledWith('assignment-1');
    expect(await harness.hasEventDetails()).toBe(false);
  });

  it('does not restore a forgotten token after authorization finishes', async () => {
    tokens.captureCredentialFromFragment.mockReturnValue('invite-secret');
    await create(null);
    const authorization = deferred<{status: 'available'}>();
    delegate.authorizeToken.mockReturnValueOnce(authorization.promise);

    fixture.componentInstance.retryLoading();
    await vi.waitFor(() =>
      expect(delegate.authorizeToken).toHaveBeenCalledTimes(2),
    );
    fixture.componentInstance.forget();
    authorization.resolve({status: 'available'});
    await fixture.whenStable();

    expect(tokens.rememberResolvedAssignment).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.view()).toBeNull();
    expect(await harness.hasEventDetails()).toBe(false);
  });

  it('does not restore a forgotten token after a reload finishes', async () => {
    tokens.captureCredentialFromFragment.mockReturnValue('invite-secret');
    await create(null);
    const reload = deferred<typeof availableView>();
    delegate.getView.mockReturnValueOnce(reload.promise);

    fixture.componentInstance.retryLoading();
    await vi.waitFor(() => expect(delegate.getView).toHaveBeenCalledTimes(2));
    fixture.componentInstance.forget();
    reload.resolve(availableView);
    await fixture.whenStable();

    expect(tokens.rememberResolvedAssignment).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.view()).toBeNull();
  });

  it('does not restore a forgotten view after Load more finishes', async () => {
    tokens.captureCredentialFromFragment.mockReturnValue('invite-secret');
    delegate.getView.mockResolvedValueOnce({
      ...availableView,
      guests: {
        ...availableView.guests,
        isDone: false,
        continueCursor: 'guest-page-2',
      },
    });
    await create(null);
    const nextPage = deferred<typeof availableView>();
    delegate.getView.mockReturnValueOnce(nextPage.promise);

    const loadMore = fixture.componentInstance.loadMoreGuests();
    await vi.waitFor(() => expect(delegate.getView).toHaveBeenCalledTimes(2));
    fixture.componentInstance.forget();
    nextPage.resolve(availableView);
    await loadMore;
    await fixture.whenStable();

    expect(tokens.rememberResolvedAssignment).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.view()).toBeNull();
  });
});
