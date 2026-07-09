import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import {CONVEX} from 'convex-angular';
import {of} from 'rxjs';
import {toast} from 'ngx-sonner';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {AuthService} from '@/core/services/auth.service';
import {
  createMockAuthService,
  createMockConvexClient,
} from '@/testing/mock-types';

import {InviteComponent} from './invite.component';

vi.mock('ngx-sonner', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

interface InviteComponentWithRedeem {
  redeemLink(token: string): Promise<void>;
  redirectTimeoutId: ReturnType<typeof setTimeout> | null;
}

interface RedeemMutationResult {
  alreadyMember: boolean;
  alreadyRedeemed: boolean;
}

interface RedeemMutationMock {
  mutation: {
    mockResolvedValue(value: RedeemMutationResult): void;
  };
}

function mockRedeemResult(
  client: RedeemMutationMock,
  result: RedeemMutationResult,
): void {
  client.mutation.mockResolvedValue(result);
}

describe('InviteComponent', () => {
  let fixture: ComponentFixture<InviteComponent>;
  let component: InviteComponent;
  let router: Router;
  let navigateSpy: ReturnType<typeof vi.spyOn>;
  let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;
  let fixtureDestroyed = false;
  let emitValidationResult: ((value: unknown) => void) | null = null;
  let convexClient = createMockConvexClient();
  let authService = createMockAuthService();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    convexClient = createMockConvexClient();
    authService = createMockAuthService();
    emitValidationResult = null;

    convexClient.onUpdate.mockImplementation(
      (_query: unknown, _args: unknown, onData: (value: unknown) => void) => {
        emitValidationResult = onData;
        onData({
          valid: true,
          communityName: 'Signal House',
        });
        return () => undefined;
      },
    );

    await TestBed.configureTestingModule({
      imports: [InviteComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: CONVEX, useValue: convexClient},
        {provide: AuthService, useValue: authService as unknown as AuthService},
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({token: 'invite-token'})),
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    fixtureDestroyed = false;

    fixture = TestBed.createComponent(InviteComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    if (!fixtureDestroyed) {
      fixture.destroy();
    }
    vi.useRealTimers();
  });

  it('clears the delayed redirect when destroyed before the timeout fires', async () => {
    mockRedeemResult(convexClient, {
      alreadyMember: false,
      alreadyRedeemed: false,
    });

    await (component as unknown as InviteComponentWithRedeem).redeemLink(
      'invite-token',
    );

    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Welcome! You are now part of the community.',
    );

    fixture.destroy();
    fixtureDestroyed = true;

    await vi.advanceTimersByTimeAsync(2_100);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('clears the delayed redirect when the view leaves success before the timeout fires', async () => {
    mockRedeemResult(convexClient, {
      alreadyMember: false,
      alreadyRedeemed: false,
    });

    const inviteComponent = component as unknown as InviteComponentWithRedeem;

    await inviteComponent.redeemLink('invite-token');

    expect(inviteComponent.redirectTimeoutId).not.toBeNull();

    emitValidationResult?.({
      valid: false,
      error: 'invalid',
    });
    fixture.detectChanges();
    TestBed.tick();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(inviteComponent.redirectTimeoutId).toBeNull();

    await vi.advanceTimersByTimeAsync(2_100);

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
