import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {ActivatedRoute, Router, convertToParamMap, provideRouter} from '@angular/router';
import {of} from 'rxjs';
import {describe, it, expect, vi} from 'vitest';
import {ConfirmSocialLinkComponent} from './confirm-social-link.component';
import {AuthService} from '@/core/services/auth.service';

describe('ConfirmSocialLinkComponent', () => {
  let fixture: ComponentFixture<ConfirmSocialLinkComponent>;
  let component: ConfirmSocialLinkComponent;
  let authServiceMock: {
    handleOAuthCallback: ReturnType<typeof vi.fn>;
    authInitialized: ReturnType<typeof signal<boolean>>;
    isAuthenticated: ReturnType<typeof signal<boolean>>;
    user: ReturnType<typeof signal<unknown>>;
  };
  let routerMock: {
    navigate: ReturnType<typeof vi.fn>;
  };

  function createActivatedRoute(queryParams: Record<string, string | undefined>) {
    return {
      queryParamMap: of(convertToParamMap(queryParams)),
      snapshot: {
        queryParamMap: {
          get: (key: string) => queryParams[key] ?? null,
        },
      },
    };
  }

  async function setupComponent(queryParams: Record<string, string | undefined> = {}) {
    authServiceMock = {
      handleOAuthCallback: vi.fn().mockResolvedValue(undefined),
      authInitialized: signal(true),
      isAuthenticated: signal(true),
      user: signal({}),
    };
    routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
    };

    await TestBed.configureTestingModule({
      imports: [ConfirmSocialLinkComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: ActivatedRoute, useValue: createActivatedRoute(queryParams)},
        {provide: AuthService, useValue: authServiceMock},
        {provide: Router, useValue: routerMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConfirmSocialLinkComponent);
    component = fixture.componentInstance;
  }

  async function renderAndSettle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('shows an error when no OTT token is present', async () => {
    await setupComponent({provider: 'google'});
    await renderAndSettle();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe('This provider link is invalid or expired. Please try again.');
    expect(authServiceMock.handleOAuthCallback).not.toHaveBeenCalled();
  });

  it('completes linking without relying on a client-side audit mutation', async () => {
    await setupComponent({ott: 'ott-token', provider: 'google'});
    await renderAndSettle();

    expect(authServiceMock.handleOAuthCallback).toHaveBeenCalledWith('ott-token', {
      navigateOnSuccess: false,
      syncUserToApp: false,
    });
    expect(component.state()).toBe('success');
    expect(routerMock.navigate).toHaveBeenCalledWith(['/account']);
  });

  it('waits for the user signal before navigating', async () => {
    await setupComponent({ott: 'ott-token', provider: 'google'});
    authServiceMock.user.set(null);
    await renderAndSettle();

    expect(routerMock.navigate).not.toHaveBeenCalled();

    authServiceMock.user.set({});
    await renderAndSettle();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/account']);
  });

  it('shows a generic provider error when the callback reports a failure', async () => {
    await setupComponent({error: 'access_denied'});
    await renderAndSettle();

    expect(component.state()).toBe('error');
    expect(component.error()).toBe('This provider could not be connected right now.');
    expect(authServiceMock.handleOAuthCallback).not.toHaveBeenCalled();
  });
});
