import {describe, it, expect, vi} from 'vitest';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {
  provideRouter,
  ActivatedRoute,
  Router,
  RouterLink,
} from '@angular/router';
import {provideZonelessChangeDetection} from '@angular/core';
import {of} from 'rxjs';
import {UnsubscribeComponent} from './unsubscribe';
import {UnsubscribeHarness} from './unsubscribe.harness';
import {
  type PreferencesResponse,
  UnsubscribePreferencesService,
} from './unsubscribe-preferences.service';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {By} from '@angular/platform-browser';

describe('UnsubscribeComponent', () => {
  type PreferencesServiceMock = Pick<
    UnsubscribePreferencesService,
    'loadPreferences' | 'togglePreference' | 'unsubscribeAll'
  >;

  async function setup(
    params: Record<string, string> = {},
    preferencesServiceOverrides: Partial<PreferencesServiceMock> = {},
  ) {
    const preferencesService: PreferencesServiceMock = {
      loadPreferences: vi.fn().mockResolvedValue(null),
      togglePreference: vi.fn().mockResolvedValue(undefined),
      unsubscribeAll: vi.fn().mockResolvedValue(undefined),
      ...preferencesServiceOverrides,
    };

    await TestBed.configureTestingModule({
      imports: [UnsubscribeComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {provide: UnsubscribePreferencesService, useValue: preferencesService},
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: of(params),
          },
        },
      ],
    }).compileComponents();

    const fixture: ComponentFixture<UnsubscribeComponent> =
      TestBed.createComponent(UnsubscribeComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      UnsubscribeHarness,
    );
    return {fixture, harness, preferencesService};
  }

  it('shows confirmation when done=true', async () => {
    const preferences: PreferencesResponse = {
      unsubscribedFrom: null,
      preferences: [],
      globalMarketingOptOut: false,
    };

    const {fixture, harness} = await setup(
      {done: 'true', token: 'test-token'},
      {loadPreferences: vi.fn().mockResolvedValue(preferences)},
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(await harness.isConfirmationVisible()).toBe(true);
    expect(await harness.isErrorVisible()).toBe(false);
  });

  it('shows error when error param is present', async () => {
    const {harness} = await setup({error: 'invalid'});
    expect(await harness.isErrorVisible()).toBe(true);
    expect(await harness.isConfirmationVisible()).toBe(false);
    expect(await harness.getErrorText()).toContain('contact support');
    expect(await harness.getSupportHref()).toBe(
      'mailto:contact@braket.gay?subject=Unsubscribe%20help',
    );
  });

  it('links invalid unsubscribe state to the account preference center', async () => {
    const {fixture} = await setup({error: 'invalid'});
    const linkDebugEl = fixture.debugElement.query(By.directive(RouterLink));
    const routerLink = linkDebugEl.injector.get(RouterLink);
    const router = TestBed.inject(Router);

    expect(router.serializeUrl(routerLink.urlTree!)).toContain(
      '/account#email-preferences',
    );
  });

  it('shows error state when no token is present (blank URL)', async () => {
    const {harness} = await setup({});
    expect(await harness.isErrorVisible()).toBe(true);
    expect(await harness.isConfirmationVisible()).toBe(false);
  });

  it('shows invalid-link recovery when done token cannot load preferences', async () => {
    const {fixture, harness, preferencesService} = await setup(
      {done: 'true', token: 'bad-token'},
      {loadPreferences: vi.fn().mockResolvedValue(null)},
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(preferencesService.loadPreferences).toHaveBeenCalledWith(
      'bad-token',
    );
    expect(await harness.isErrorVisible()).toBe(true);
    expect(await harness.isConfirmationVisible()).toBe(false);
    expect(await harness.getErrorText()).toContain('Sign in to manage');
  });

  it('shows invalid-link recovery when a direct token link cannot load preferences', async () => {
    const {fixture, harness, preferencesService} = await setup(
      {token: 'bad-token'},
      {loadPreferences: vi.fn().mockResolvedValue(null)},
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(preferencesService.loadPreferences).toHaveBeenCalledWith(
      'bad-token',
    );
    expect(await harness.isErrorVisible()).toBe(true);
    expect(await harness.isConfirmationVisible()).toBe(false);
    expect(await harness.getErrorText()).toContain('Sign in to manage');
  });

  it('shows the preference center for a valid direct token link', async () => {
    const preferences: PreferencesResponse = {
      unsubscribedFrom: null,
      preferences: [
        {
          organizerId: 'org1',
          organizerName: 'Test Community',
          optedIn: true,
          isAdmin: false,
        },
      ],
      globalMarketingOptOut: false,
    };

    const {fixture, harness, preferencesService} = await setup(
      {token: 'test-token'},
      {loadPreferences: vi.fn().mockResolvedValue(preferences)},
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(preferencesService.loadPreferences).toHaveBeenCalledWith(
      'test-token',
    );
    expect(await harness.isErrorVisible()).toBe(false);
    expect(await harness.isConfirmationVisible()).toBe(true);
    expect(await harness.getPreferencesIntroText()).toContain(
      'Manage your email preferences',
    );
  });

  it('shows org name from preferences after unsubscribe', async () => {
    const preferences: PreferencesResponse = {
      unsubscribedFrom: {organizerName: 'Test Community', organizerId: 'org1'},
      preferences: [],
      globalMarketingOptOut: false,
    };

    const {fixture, preferencesService} = await setup(
      {done: 'true', token: 'test-token'},
      {loadPreferences: vi.fn().mockResolvedValue(preferences)},
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      UnsubscribeHarness,
    );
    expect(preferencesService.loadPreferences).toHaveBeenCalledWith(
      'test-token',
    );
    expect(await harness.isConfirmationVisible()).toBe(true);
    expect(await harness.getOrganizationName()).toBe('Test Community');
  });

  it('shows global opt-out banner when globalMarketingOptOut is true', async () => {
    const preferences: PreferencesResponse = {
      unsubscribedFrom: {organizerName: 'Test Community', organizerId: 'org1'},
      preferences: [],
      globalMarketingOptOut: true,
    };

    const {fixture} = await setup(
      {done: 'true', token: 'test-token'},
      {loadPreferences: vi.fn().mockResolvedValue(preferences)},
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      UnsubscribeHarness,
    );
    expect(await harness.isGlobalOptOutBannerVisible()).toBe(true);
  });

  it('hides global opt-out banner when globalMarketingOptOut is false', async () => {
    const preferences: PreferencesResponse = {
      unsubscribedFrom: {organizerName: 'Test Community', organizerId: 'org1'},
      preferences: [],
      globalMarketingOptOut: false,
    };

    const {fixture} = await setup(
      {done: 'true', token: 'test-token'},
      {loadPreferences: vi.fn().mockResolvedValue(preferences)},
    );
    await fixture.whenStable();
    fixture.detectChanges();

    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      UnsubscribeHarness,
    );
    expect(await harness.isGlobalOptOutBannerVisible()).toBe(false);
  });
});
