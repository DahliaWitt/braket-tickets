import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  type ParamMap,
  provideRouter,
} from '@angular/router';
import {of} from 'rxjs';
import {vi} from 'vitest';

import {AuthService} from '@/core/services/auth.service';
import {PasswordService} from '@/core/services/password.service';

import {LoginComponent} from './login.component';

function createQueryParamMap(queryParams: Record<string, string>): ParamMap {
  return {
    keys: Object.keys(queryParams),
    get: (name: string) => queryParams[name] ?? null,
    getAll: (name: string) => {
      return Object.prototype.hasOwnProperty.call(queryParams, name)
        ? [queryParams[name]]
        : [];
    },
    has: (name: string) =>
      Object.prototype.hasOwnProperty.call(queryParams, name),
  };
}

describe('LoginComponent invite handoff', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let router: Router;
  let authServiceMock: {
    loginWithPassword: ReturnType<typeof vi.fn>;
    signup: ReturnType<typeof vi.fn>;
    requestPasswordReset: ReturnType<typeof vi.fn>;
    loginWithSocial: ReturnType<typeof vi.fn>;
    requestVerificationEmail: ReturnType<typeof vi.fn>;
    currentUser: ReturnType<typeof vi.fn>;
    userRole: ReturnType<typeof vi.fn>;
    authInitialized: ReturnType<typeof vi.fn>;
    isAuthenticated: ReturnType<typeof vi.fn>;
    user: ReturnType<typeof vi.fn>;
  };

  async function createComponent(queryParams: Record<string, string>) {
    authServiceMock = {
      loginWithPassword: vi.fn().mockResolvedValue(undefined),
      signup: vi.fn().mockResolvedValue(undefined),
      requestPasswordReset: vi.fn().mockResolvedValue(undefined),
      loginWithSocial: vi.fn().mockResolvedValue(undefined),
      requestVerificationEmail: vi.fn().mockResolvedValue(undefined),
      currentUser: vi.fn(() => null),
      userRole: vi.fn(() => 'user'),
      authInitialized: vi.fn(() => false),
      isAuthenticated: vi.fn(() => false),
      user: vi.fn(() => null),
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AuthService, useValue: authServiceMock},
        {provide: PasswordService, useValue: authServiceMock},
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return {
                queryParamMap: {
                  get: (key: string) => queryParams[key] ?? null,
                },
                queryParams: {...queryParams},
              };
            },
            get queryParams() {
              return of({...queryParams});
            },
            get queryParamMap() {
              return of(createQueryParamMap(queryParams));
            },
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate');
    vi.spyOn(router, 'navigateByUrl');

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('opens the register tab when the invite CTA passes signup=true', async () => {
    await createComponent({signup: 'true'});

    expect(component.activeTab()).toBe('register');
  });

  it('keeps the login tab when registered=true and shows the success message', async () => {
    await createComponent({registered: 'true'});

    expect(component.activeTab()).toBe('login');
    expect(component.message()).toContain('verification email has been sent');
  });

  it('passes the invite returnUrl through registration submit', async () => {
    await createComponent({returnUrl: '/admin-invite/invite-token'});

    component.activeTab.set('register');
    component.registerModel.update((m) => ({
      ...m,
      name: 'Invited User',
      email: 'invited@example.com',
      password: 'password123',
      passwordConfirm: 'password123',
      termsAccepted: true,
    }));

    await component.onRegister();

    expect(authServiceMock.signup).toHaveBeenCalledWith(
      'invited@example.com',
      'password123',
      'password123',
      'Invited User',
      '/admin-invite/invite-token',
    );
  });

  it('redirects OAuth callback query params to social signin confirmation', async () => {
    await createComponent({code: 'oauth-code', returnUrl: '/tickets'});

    expect(router.navigate).toHaveBeenCalledWith(['/confirm/social-signin'], {
      queryParams: {
        code: 'oauth-code',
        returnUrl: '/tickets',
      },
      replaceUrl: true,
    });
  });
});
