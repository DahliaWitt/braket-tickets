import '../../../test-setup';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {provideRouter} from '@angular/router';
import {RouterTestingHarness} from '@angular/router/testing';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {GuestListDelegateService} from './services/guest-list-delegate.service';
import {GuestListAssignmentTokenStoreService} from './services/guest-list-assignment-token-store.service';
import {GuestListManageComponent} from './pages/guest-list-manage/guest-list-manage.component';

describe('delegate guest-list routes', () => {
  const delegate = {
    authorizeToken: vi.fn(),
    claimSignedIn: vi.fn(),
    getView: vi.fn(),
  };
  const tokens = {
    captureCredentialFromFragment: vi.fn(),
    getMostRecent: vi.fn(),
    rememberResolvedAssignment: vi.fn(),
    forget: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delegate.getView.mockResolvedValue({status: 'unavailable'});
    delegate.authorizeToken.mockResolvedValue({status: 'available'});
    delegate.claimSignedIn.mockResolvedValue({status: 'available'});
    tokens.captureCredentialFromFragment.mockReturnValue(null);
    tokens.getMostRecent.mockReturnValue(null);

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          {path: 'guest-list/manage', component: GuestListManageComponent},
          {
            path: 'guest-lists/:assignmentId',
            component: GuestListManageComponent,
          },
        ]),
        {provide: GuestListDelegateService, useValue: delegate},
        {provide: GuestListAssignmentTokenStoreService, useValue: tokens},
      ],
    });
  });

  it('opens the public accountless route without requiring authentication', async () => {
    const harness = await RouterTestingHarness.create();

    await expect(
      harness.navigateByUrl('/guest-list/manage', GuestListManageComponent),
    ).resolves.toBeInstanceOf(GuestListManageComponent);
    expect(tokens.captureCredentialFromFragment).toHaveBeenCalledOnce();
  });

  it('passes the signed-in route assignment id to delegate access', async () => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl(
      '/guest-lists/assignment-1',
      GuestListManageComponent,
    );
    await harness.fixture.whenStable();

    expect(delegate.getView).toHaveBeenCalledWith({
      kind: 'signedIn',
      assignmentId: 'assignment-1',
    });
  });
});
