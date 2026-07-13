import '../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {
  provideRouter,
  ActivatedRoute,
  convertToParamMap,
} from '@angular/router';
import {of} from 'rxjs';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {InviteRedeemComponent} from './invite-redeem.component';
import {InviteRedeemComponentHarness} from './invite-redeem.component.harness';
import {AuthService} from '@/core/services/auth.service';
import {AdminInvitesService} from '@/features/admin/services/admin-invites.service';
import {ConvexError} from 'convex/values';

describe('InviteRedeemComponent', () => {
  let fixture: ComponentFixture<InviteRedeemComponent>;
  let component: InviteRedeemComponent;

  const authInitializedSignal = signal(true);
  const isAuthenticatedSignal = signal(false);

  const mockAuth = {
    authInitialized: authInitializedSignal,
    isAuthenticated: isAuthenticatedSignal,
    user: signal(null),
    userRole: signal('user'),
    isCommunityAdmin: signal(false),
  };

  const mockInvites = {
    redeem: vi.fn(),
    createWithCommunity: vi.fn(),
    cancel: vi.fn(),
  };

  beforeEach(async () => {
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(false);
    mockInvites.redeem.mockReset();

    await TestBed.configureTestingModule({
      imports: [InviteRedeemComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {paramMap: of(convertToParamMap({token: 'test-token'}))},
        },
        {provide: AuthService, useValue: mockAuth},
        {provide: AdminInvitesService, useValue: mockInvites},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InviteRedeemComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows login prompt when not authenticated', async () => {
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(false);

    fixture.componentRef.setInput('token', 'test-token');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.needsLogin()).toBe(true);
    expect(component.loading()).toBe(false);
    expect(component.success()).toBe(false);
  });

  it('sets returnUrl to /admin-invite/:token when not authenticated', async () => {
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(false);

    fixture.componentRef.setInput('token', 'test-token');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.returnUrl()).toBe('/admin-invite/test-token');
  });

  it('links the sign-in CTA to the login tab without the signup param', async () => {
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(false);

    fixture.componentRef.setInput('token', 'test-token');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      InviteRedeemComponentHarness,
    );
    expect(await harness.getSignInHref()).toBe(
      '/login?returnUrl=%2Fadmin-invite%2Ftest-token',
    );
  });

  it('links the create-account CTA to registration with the invite returnUrl', async () => {
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(false);

    fixture.componentRef.setInput('token', 'test-token');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      InviteRedeemComponentHarness,
    );
    expect(await harness.getCreateAccountHref()).toBe(
      '/login?returnUrl=%2Fadmin-invite%2Ftest-token&signup=true',
    );
  });

  it('calls redeem when authenticated and token is present', async () => {
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(true);
    mockInvites.redeem.mockResolvedValue({organizerId: 'org-1'});

    fixture.componentRef.setInput('token', 'test-token');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockInvites.redeem).toHaveBeenCalledWith('test-token');
    expect(component.success()).toBe(true);
    expect(component.loading()).toBe(false);
  });

  it('shows error state when redemption fails', async () => {
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(true);
    mockInvites.redeem.mockRejectedValue(
      new ConvexError({
        code: 'INVITE_EXPIRED',
        message: 'This invitation has expired',
      }),
    );

    fixture.componentRef.setInput('token', 'test-token');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.success()).toBe(false);
    expect(component.needsLogin()).toBe(false);
    expect(component.error()).toBe('This invitation has expired');
    expect(component.loading()).toBe(false);
  });

  it.each([
    ['INVITE_CANCELLED', 'This invitation has been cancelled'],
    ['INVITE_ALREADY_REDEEMED', 'This invitation has already been redeemed'],
    ['INVITE_EXPIRED', 'This invitation has expired'],
    ['EMAIL_MISMATCH', 'This invitation was sent to a different email address'],
  ])(
    'shows known invite-domain error %s without exposing backend details',
    async (code, message) => {
      authInitializedSignal.set(true);
      isAuthenticatedSignal.set(true);
      mockInvites.redeem.mockRejectedValue(new ConvexError({code, message}));

      fixture.componentRef.setInput('token', 'test-token');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(component.error()).toBe(message);
    },
  );

  it('does not render raw backend details for invalid invite tokens', async () => {
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(true);
    mockInvites.redeem.mockRejectedValue(
      new ConvexError({
        code: 'INVALID_TOKEN',
        message: 'This invitation does not exist or has already been used',
      }),
    );

    fixture.componentRef.setInput('token', 'bad-token');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      InviteRedeemComponentHarness,
    );
    const errorText = await harness.getErrorText();

    expect(await harness.isErrorVisible()).toBe(true);
    expect(errorText).toBe(
      'This invitation link is invalid or has expired. Please request a new invite.',
    );
    expect(errorText).not.toContain('ConvexError');
    expect(errorText).not.toContain('INVALID_TOKEN');
    expect(errorText).not.toContain('Request ID');
    expect(errorText).not.toContain('backend/convex');
    expect(errorText).not.toContain('adminInvites:redeem');
    expect(errorText).not.toContain('at redeemInvite');
  });

  it('does not render raw backend details for unexpected redemption failures', async () => {
    authInitializedSignal.set(true);
    isAuthenticatedSignal.set(true);
    mockInvites.redeem.mockRejectedValue(
      new Error(
        [
          'ConvexError: INTERNAL_SERVER_ERROR',
          'Request ID: req_unexpected',
          'Function: communities/management/invites:redeem',
          'Path: backend/convex/communities/management/_impl/invites.ts:118',
          'at redeemInvite (backend/convex/communities/management/_impl/invites.ts:118:7)',
        ].join('\n'),
      ),
    );

    fixture.componentRef.setInput('token', 'test-token');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      InviteRedeemComponentHarness,
    );
    const errorText = await harness.getErrorText();

    expect(await harness.isErrorVisible()).toBe(true);
    expect(errorText).toBe('Failed to accept invitation.');
    expect(errorText).not.toContain('ConvexError');
    expect(errorText).not.toContain('INTERNAL_SERVER_ERROR');
    expect(errorText).not.toContain('Request ID');
    expect(errorText).not.toContain('backend/convex');
    expect(errorText).not.toContain('communities/management/invites:redeem');
    expect(errorText).not.toContain('at redeemInvite');
  });
});
