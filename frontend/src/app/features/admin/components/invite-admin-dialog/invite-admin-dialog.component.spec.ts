import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {
  InviteAdminDialogComponent,
  type InviteAdminDialogCloseResult,
} from './invite-admin-dialog.component';
import {InviteAdminDialogHarness} from './invite-admin-dialog.harness';
import {AdminInvitesService} from '@/features/admin/services/admin-invites.service';
import {type Id} from '@convex/_generated/dataModel';
import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';

describe('InviteAdminDialogComponent', () => {
  let fixture: ComponentFixture<InviteAdminDialogComponent>;
  let component: InviteAdminDialogComponent;
  let harness: InviteAdminDialogHarness;
  let invitesMock: {
    createWithCommunity: ReturnType<typeof vi.fn>;
    redeem: ReturnType<typeof vi.fn>;
    cancel: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    invitesMock = {
      createWithCommunity: vi.fn().mockResolvedValue({
        inviteId: 'invite-1' as Id<'admin_invites'>,
        organizerId: 'org-1' as Id<'organizers'>,
        inviteUrl: 'http://localhost:4200/admin-invite/abc123',
      }),
      redeem: vi.fn(),
      cancel: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [InviteAdminDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AdminInvitesService, useValue: invitesMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InviteAdminDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      InviteAdminDialogHarness,
    );
  });

  it('should render the form by default', async () => {
    const isSuccess = await harness.isSuccessStateVisible();
    expect(isSuccess).toBe(false);
  });

  it('should have form invalid when empty', () => {
    expect(component.f().valid()).toBe(false);
  });

  it('should populate communityName field', async () => {
    await harness.setCommunityName('Test Community');
    fixture.detectChanges();
    const val = await harness.getCommunityNameValue();
    expect(val).toBe('Test Community');
  });

  it('should populate email field', async () => {
    await harness.setEmail('admin@example.com');
    fixture.detectChanges();
    const val = await harness.getEmailValue();
    expect(val).toBe('admin@example.com');
  });

  it('should show success state after successful submit', async () => {
    // Update form model directly (since CDK harness + Signal Forms + zoneless can be tricky)
    component.formModel.set({
      communityName: 'My Community',
      email: 'admin@example.com',
    });
    fixture.detectChanges();

    await component.submit(new Event('submit'));
    fixture.detectChanges();

    await fixture.whenStable();
    fixture.detectChanges();

    expect(invitesMock.createWithCommunity).toHaveBeenCalledWith(
      'admin@example.com',
      'My Community',
    );
    expect(component.sent()).toBe(true);
    expect(component.sentEmail()).toBe('admin@example.com');

    const isSuccess = await harness.isSuccessStateVisible();
    expect(isSuccess).toBe(true);
  });

  it('should emit closed event when cancel is clicked', async () => {
    let closedEmitted = false;
    component.closed.subscribe(() => {
      closedEmitted = true;
    });

    await harness.clickCancel();
    expect(closedEmitted).toBe(true);
  });

  it('should emit closed event when done button is clicked after success', async () => {
    component.sent.set(true);
    component.sentEmail.set('admin@example.com');
    fixture.detectChanges();

    let closedEmitted = false;
    component.closed.subscribe(() => {
      closedEmitted = true;
    });

    await harness.clickDone();
    expect(closedEmitted).toBe(true);
  });

  it('should not call service when form is invalid', async () => {
    // Form is empty (no community name, no email) — invalid
    expect(component.f().valid()).toBe(false);

    await component.submit(new Event('submit'));
    expect(invitesMock.createWithCommunity).not.toHaveBeenCalled();
  });
});

describe('InviteAdminDialogHarness', () => {
  let fixture: ComponentFixture<InviteAdminDialogComponent>;
  let harness: InviteAdminDialogHarness;
  let invitesMock: {createWithCommunity: ReturnType<typeof vi.fn>};

  beforeEach(async () => {
    invitesMock = {
      createWithCommunity: vi.fn().mockResolvedValue({
        inviteId: 'invite-1' as Id<'admin_invites'>,
        organizerId: 'org-1' as Id<'organizers'>,
        inviteUrl: 'http://localhost:4200/admin-invite/abc123',
      }),
    };

    await TestBed.configureTestingModule({
      imports: [InviteAdminDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AdminInvitesService, useValue: invitesMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InviteAdminDialogComponent);
    fixture.detectChanges();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      InviteAdminDialogHarness,
    );
  });

  it('should set and get communityName via harness', async () => {
    await harness.setCommunityName('Rave Collective');
    fixture.detectChanges();
    expect(await harness.getCommunityNameValue()).toBe('Rave Collective');
  });

  it('should set and get email via harness', async () => {
    await harness.setEmail('organizer@rave.com');
    fixture.detectChanges();
    expect(await harness.getEmailValue()).toBe('organizer@rave.com');
  });

  it('should report success state as false initially', async () => {
    expect(await harness.isSuccessStateVisible()).toBe(false);
  });
});

describe('InviteAdminDialogComponent in shared dialog mode', () => {
  it('should close the shared dialog when cancel is clicked', async () => {
    const dialogRefMock = {
      close: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [InviteAdminDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AdminInvitesService,
          useValue: {
            createWithCommunity: vi.fn(),
            redeem: vi.fn(),
            cancel: vi.fn(),
          },
        },
        {provide: BraDialogRef, useValue: dialogRefMock},
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(InviteAdminDialogComponent);
    fixture.detectChanges();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      InviteAdminDialogHarness,
    );

    await harness.clickCancel();

    expect(dialogRefMock.close).toHaveBeenCalledWith<
      [InviteAdminDialogCloseResult]
    >({refreshCommunities: true});
  });

  it('marks cancel as the initial focus target in shared dialog mode', async () => {
    const dialogRefMock = {
      close: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [InviteAdminDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AdminInvitesService,
          useValue: {
            createWithCommunity: vi.fn(),
            redeem: vi.fn(),
            cancel: vi.fn(),
          },
        },
        {provide: BraDialogRef, useValue: dialogRefMock},
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(InviteAdminDialogComponent);
    fixture.detectChanges();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      InviteAdminDialogHarness,
    );

    expect(await harness.isCancelInitialFocus()).toBe(true);
  });
});
