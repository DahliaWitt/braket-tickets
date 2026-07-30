import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {manualChangeDetection} from '@angular/cdk/testing';
import {VettingComponent} from './vetting.component';
import {AuthService} from '@/core/services/auth.service';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {CommunitiesService} from '@/core/services/communities.service';
import {DashboardDataService} from '@/features/dashboard/services/dashboard-data.service';
import {Router, provideRouter} from '@angular/router';
import {VettingComponentHarness} from './vetting.component.harness';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {signal, type WritableSignal} from '@angular/core';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {computed} from '@angular/core';
import {ConvexError} from 'convex/values';
import {CONVEX} from 'convex-angular';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {type Application} from '@/features/vetting/models/application.model';

// Real ConvexReactClient never invokes the data callback synchronously from
// inside `onUpdate` — the first emission always arrives on a later microtask
// once the socket/local store settles. Mirror that contract so the mock drives
// injectQuery through the same async path production code sees (pending ->
// settled) instead of collapsing the loading state in the same tick the
// subscription is created.
const emitAsync = (onData: (data: unknown) => void, value: unknown): void => {
  queueMicrotask(() => onData(value));
};

describe('VettingComponent', () => {
  let fixture: ComponentFixture<VettingComponent>;
  let harness: VettingComponentHarness;
  let authServiceMock: unknown;
  let vettingAuthSettled: WritableSignal<boolean>;
  let appsServiceMock: unknown;
  let communitiesServiceMock: unknown;
  let dashboardDataMock: unknown;
  let router: Router;
  let mockConvexClient: MockConvexClient;

  // Per-test control over the existing-application subscription (the only
  // Convex subscription the component opens). The onUpdate router below reads
  // these; each test tweaks them before creating the fixture.
  let existingApplicationDoc: unknown = null;
  let suppressExistingEmit = false;
  let existingApplicationError: Error | null = null;
  let emitExisting: ((v: unknown) => void) | undefined;
  let emitExistingError: ((e: Error) => void) | undefined;

  async function waitForVettingResource(): Promise<void> {
    await new Promise((resolve) =>
      requestAnimationFrame(() => resolve(undefined)),
    );
    fixture.detectChanges();
    await new Promise((resolve) =>
      requestAnimationFrame(() => resolve(undefined)),
    );
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function readStoredDraft(key: string): Record<string, unknown> {
    const rawDraft = sessionStorage.getItem(key);
    expect(rawDraft).not.toBeNull();
    const parsed: unknown = JSON.parse(rawDraft ?? '{}');
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
    return parsed as Record<string, unknown>;
  }

  function createPendingPromise<T>(): Promise<T> {
    return new Promise<T>((_resolve, _reject) => undefined);
  }

  async function setupExistingApplicationLoading(): Promise<
    ComponentFixture<VettingComponent>
  > {
    // Questions resolve (organizerId sets) so the existing-application query
    // subscribes, but the subscription never emits -> query.isLoading() stays
    // true -> the gate blocks the form.
    suppressExistingEmit = true;

    const loadingFixture = TestBed.createComponent(VettingComponent);
    loadingFixture.componentRef.setInput('id', 'org-123');
    loadingFixture.detectChanges();

    await new Promise((resolve) =>
      requestAnimationFrame(() => resolve(undefined)),
    );
    loadingFixture.detectChanges();
    await loadingFixture.whenStable();
    loadingFixture.detectChanges();

    return loadingFixture;
  }

  async function setupQuestionsLoading(): Promise<
    ComponentFixture<VettingComponent>
  > {
    (
      communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
    ).getBySlugOrId.mockReturnValue(createPendingPromise());

    const loadingFixture = TestBed.createComponent(VettingComponent);
    loadingFixture.componentRef.setInput('id', 'org-123');
    loadingFixture.detectChanges();

    return loadingFixture;
  }

  beforeEach(async () => {
    // Clear sessionStorage to prevent form state from leaking between tests
    sessionStorage.clear();

    // Reset the existing-application subscription controls.
    existingApplicationDoc = null;
    suppressExistingEmit = false;
    existingApplicationError = null;
    emitExisting = undefined;
    emitExistingError = undefined;

    const userSignal = signal({
      _id: '123',
      id: '123',
      email: 'test@example.com',
    });

    vettingAuthSettled = signal(true);
    authServiceMock = {
      user: userSignal,
      currentUser: computed(() => userSignal()),
      authSettled: vettingAuthSettled,
    };

    appsServiceMock = {
      create: vi.fn().mockResolvedValue({id: 'app-123'}),
      // The component maps the raw subscription document via mapToApp; mirror
      // the real service's identity-preserving validation so status/denyReason
      // flow through to the derived signals.
      mapToApp: vi.fn((doc: unknown): Application | null =>
        doc && typeof doc === 'object' && '_id' in doc
          ? (doc as Application)
          : null,
      ),
    };

    mockConvexClient = createMockConvexClient();
    // The existing-application query is the ONLY Convex subscription the
    // component opens (questionsResource still uses the mocked
    // CommunitiesService, not Convex), so a single router suffices.
    const onUpdate = vi
      .fn()
      .mockImplementation(
        (
          queryRef: unknown,
          args: unknown,
          onData: (d: unknown) => void,
          onError?: (e: Error) => void,
        ) => {
          void queryRef;
          void args;
          emitExisting = onData;
          if (onError) emitExistingError = onError;
          if (suppressExistingEmit) return () => void 0; // keeps isLoading() true
          if (existingApplicationError) {
            const err = existingApplicationError;
            if (onError) queueMicrotask(() => onError(err));
            return () => void 0;
          }
          emitAsync(onData, existingApplicationDoc); // default null -> form renders
          return () => void 0;
        },
      );
    mockConvexClient.onUpdate = onUpdate;
    mockConvexClient.client.onUpdate = onUpdate;

    communitiesServiceMock = {
      list: vi.fn().mockResolvedValue([]),
      getBySlugOrId: vi.fn().mockResolvedValue({
        _id: 'org-123',
        name: 'Test Community',
        status: 'published',
        codeOfConduct:
          'Respect the space, respect consent, and look out for each other.',
        vettingQuestions: [
          {
            id: 'referral',
            question: 'How did you hear about us?',
            type: 'text',
            required: true,
          },
          {
            id: 'whyJoin',
            question: 'Why do you want to join?',
            type: 'long_text',
            required: true,
            minLength: 20,
          },
          {
            id: 'socials',
            question: 'Social media links',
            type: 'text',
            required: false,
          },
        ],
      }),
    };

    dashboardDataMock = {
      triggerRefresh: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [VettingComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{path: 'vetting/:id', component: VettingComponent}]),
        {provide: AuthService, useValue: authServiceMock},
        {provide: ApplicationsService, useValue: appsServiceMock},
        {provide: CommunitiesService, useValue: communitiesServiceMock},
        {provide: DashboardDataService, useValue: dashboardDataMock},
        {provide: CONVEX, useValue: mockConvexClient},
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    // Navigate to route with id param before creating component
    await router.navigate(['/vetting', 'org-123']);

    fixture = TestBed.createComponent(VettingComponent);
    // Set the id input directly since component input binding requires extra config
    fixture.componentRef.setInput('id', 'org-123');
    fixture.detectChanges();

    // Wait for the resource to resolve and effect to run
    await waitForVettingResource();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      VettingComponentHarness,
    );
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the gate skeleton during the optimistic activation window', async () => {
    // Route admitted on a cached credential: auth not settled, user-keyed
    // resources idle. The gate skeleton must render, not an empty form.
    vettingAuthSettled.set(false);
    fixture.detectChanges();

    expect(await harness.isGateLoadingStateVisible()).toBe(true);
  });

  it('should have invalid form and disabled submit button initially', async () => {
    const formInstance = fixture.componentInstance.vettingForm();
    expect(formInstance).not.toBeNull();
    const formState = formInstance!();
    expect(formState.invalid()).toBe(true);
    expect(await harness.isSubmitDisabled()).toBe(true);
  });

  it('should apply high-contrast text styles to text entry fields', async () => {
    const referralClasses = await harness.getReferralInputClasses();
    const whyJoinClasses = await harness.getWhyJoinInputClasses();

    expect(referralClasses).toContain('text-foreground');
    expect(referralClasses).toContain('bg-input');
    expect(whyJoinClasses).toContain('text-foreground');
    expect(whyJoinClasses).toContain('bg-input');
  });

  describe('Code of Conduct agreement', () => {
    it('hides the agreement and does not require conduct when no code of conduct is set', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'org-123',
        name: 'No Conduct Community',
        status: 'published',
        vettingQuestions: [
          {
            id: 'referral',
            question: 'How did you hear about us?',
            type: 'text',
            required: true,
          },
          {
            id: 'whyJoin',
            question: 'Why do you want to join?',
            type: 'long_text',
            required: true,
          },
          {
            id: 'socials',
            question: 'Social media links',
            type: 'text',
            required: false,
          },
        ],
      });

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isConductAgreementVisible()).toBe(false);
      expect(await harness.isCodeOfConductButtonVisible()).toBe(false);

      await harness.setReferral('Friend recommended me');
      await harness.setWhyJoin(
        'I want to join to support the community and attend events. This is long enough.',
      );
      await harness.setSocials('@instagram');
      fixture.detectChanges();

      expect(await harness.isSubmitDisabled()).toBe(false);

      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();

      expect(
        (appsServiceMock as {create: ReturnType<typeof vi.fn>}).create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          answers: expect.objectContaining({
            referral: 'Friend recommended me',
            whyJoin:
              'I want to join to support the community and attend events. This is long enough.',
            socials: '@instagram',
            source: 'web',
          }) as unknown,
        }),
      );
    });

    it('treats whitespace-only code of conduct content as missing', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'org-123',
        name: 'Blank Conduct Community',
        status: 'published',
        codeOfConduct: '   \n\t  ',
        vettingQuestions: [
          {
            id: 'referral',
            question: 'How did you hear about us?',
            type: 'text',
            required: true,
          },
          {
            id: 'whyJoin',
            question: 'Why do you want to join?',
            type: 'long_text',
            required: true,
          },
          {
            id: 'socials',
            question: 'Social media links',
            type: 'text',
            required: false,
          },
        ],
      });

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isConductAgreementVisible()).toBe(false);
      expect(await harness.isCodeOfConductButtonVisible()).toBe(false);

      await harness.setReferral('Friend recommended me');
      await harness.setWhyJoin(
        'I want to join to support the community and attend events. This is long enough.',
      );
      fixture.detectChanges();

      expect(await harness.isSubmitDisabled()).toBe(false);
    });
  });

  describe('Form Validation', () => {
    it('selects required boolean answers when the radio or label is clicked', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'org-123',
        name: 'Radio Community',
        status: 'published',
        vettingQuestions: [
          {
            id: 'referral',
            question: 'How did you hear about us?',
            type: 'text',
            required: true,
          },
          {
            id: 'notACop',
            question: 'Are you not a cop?',
            type: 'boolean',
            required: true,
          },
        ],
      });

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(undefined)),
      );
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      await harness.setReferral('Friend recommended me');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isSubmitDisabled()).toBe(true);

      await harness.clickBooleanRadio('notACop', 'true');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isBooleanRadioSelected('notACop', 'true')).toBe(
        true,
      );
      expect(await harness.isSubmitDisabled()).toBe(false);

      await harness.clickBooleanLabel('notACop', 'false');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isBooleanRadioSelected('notACop', 'false')).toBe(
        true,
      );
      expect(await harness.isSubmitDisabled()).toBe(false);
    });

    it('requires at least one option for required checkbox questions', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'org-123',
        name: 'Checkbox Community',
        status: 'published',
        vettingQuestions: [
          {
            id: 'referral',
            question: 'How did you hear about us?',
            type: 'text',
            required: true,
          },
          {
            id: 'genres',
            question: 'Which sounds do you like?',
            type: 'checkbox',
            required: true,
            options: ['Techno', 'Noise'],
          },
        ],
      });

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await waitForVettingResource();
      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      await harness.setReferral('Friend recommended me');
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isSubmitDisabled()).toBe(true);

      const field = fixture.componentInstance.getField('genres');
      expect(field).not.toBeNull();
      field?.().markAsTouched();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(
        field?.()
          .errors()
          .some((error) => error.kind === 'required'),
      ).toBe(true);

      await harness.clickCheckboxOption('genres', 0);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(await harness.isCheckboxOptionSelected('genres', 0)).toBe(true);
      expect(await harness.isSubmitDisabled()).toBe(false);
    });

    it('should show error when referral is touched but empty', async () => {
      await harness.setReferral('temp');
      fixture.detectChanges();
      await fixture.whenStable();

      await harness.setReferral('');
      fixture.detectChanges();
      await fixture.whenStable();

      // Verify field is touched and invalid
      const referralField = fixture.componentInstance.getField('referral');
      if (referralField) {
        const state = referralField();
        // Force touch if needed (signal forms should mark as touched on blur, but let's verify)
        if (!state.touched()) {
          state.markAsTouched();
          fixture.detectChanges();
          await fixture.whenStable();
        }
      }

      const error = await harness.getReferralErrorText();
      expect(error).toBeTruthy();
      if (error) {
        expect(error.toUpperCase()).toContain('REQUIRED');
      }
    });

    it('should show error when conduct checkbox is touched but not checked', async () => {
      // Touching conduct checkbox by toggling it twice
      await harness.toggleConduct();
      fixture.detectChanges();
      await harness.toggleConduct();
      fixture.detectChanges();

      const error = await harness.getConductErrorText();
      expect(error?.toUpperCase()).toContain('AGREE');
    });

    it('should have disabled submit button if conduct is not checked', async () => {
      await harness.setReferral('Friend');
      await harness.setWhyJoin(
        'I want to join to support the community and attend events. This is long enough.',
      );
      fixture.detectChanges();

      expect(await harness.isSubmitDisabled()).toBe(true);
    });

    // sendKeys(10001 chars) triggers 10001+ CD cycles; allow extra headroom under heavy CI load.
    it('should show maxLength error when answer exceeds 10000 characters', async () => {
      const overLimitValue = 'a'.repeat(10001);
      await harness.setWhyJoin(overLimitValue);
      fixture.detectChanges();
      await fixture.whenStable();

      // Verify the field is invalid due to maxLength
      const whyJoinField = fixture.componentInstance.getField('whyJoin');
      expect(whyJoinField).not.toBeNull();
      if (whyJoinField) {
        const state = whyJoinField();
        if (!state.touched()) {
          state.markAsTouched();
          fixture.detectChanges();
          await fixture.whenStable();
        }
        expect(state.invalid()).toBe(true);
        const errors = state.errors();
        expect(errors.some((e: {kind: string}) => e.kind === 'maxLength')).toBe(
          true,
        );
      }

      const errorText = await harness.getWhyJoinMaxErrorText();
      expect(errorText).toBeTruthy();
      expect(errorText).toContain('10,000');
    }, 30_000);

    it('should not show maxLength error for answer at exactly 10000 characters', async () => {
      const atLimitValue = 'a'.repeat(10000);
      await harness.setWhyJoin(atLimitValue);
      fixture.detectChanges();
      await fixture.whenStable();

      const whyJoinField = fixture.componentInstance.getField('whyJoin');
      if (whyJoinField) {
        const state = whyJoinField();
        const errors = state.errors();
        expect(errors.some((e: {kind: string}) => e.kind === 'maxLength')).toBe(
          false,
        );
      }
    }, 30_000);
  });

  describe('Form Restore', () => {
    it('saves draft answers when navigating away before the debounce completes', async () => {
      await harness.setReferral('Saved before route teardown');
      await harness.setWhyJoin(
        'This draft should be persisted even if navigation happens immediately.',
      );
      fixture.detectChanges();

      fixture.destroy();

      const draft = readStoredDraft('vetting-form-org-123');
      expect(draft['referral']).toBe('Saved before route teardown');
      expect(draft['whyJoin']).toBe(
        'This draft should be persisted even if navigation happens immediately.',
      );
    });

    it('does not save a draft for an untouched form', () => {
      fixture.destroy();

      expect(sessionStorage.getItem('vetting-form-org-123')).toBeNull();
    });

    it('saves a draft when only the code of conduct is checked', async () => {
      await harness.toggleConduct();
      fixture.detectChanges();

      fixture.destroy();

      const draft = readStoredDraft('vetting-form-org-123');
      expect(draft['conduct']).toBe(true);
    });

    it('restores boolean radio and checkbox answers from saved drafts', async () => {
      fixture.destroy();
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'restore-community',
        name: 'Restore Community',
        status: 'published',
        vettingQuestions: [
          {
            id: 'notACop',
            question: 'Are you not a cop?',
            type: 'boolean',
            required: true,
          },
          {
            id: 'genres',
            question: 'Which sounds do you like?',
            type: 'checkbox',
            required: false,
            options: ['Techno', 'Noise'],
          },
        ],
      });
      sessionStorage.setItem(
        'vetting-form-restore-community',
        JSON.stringify({
          notACop: true,
          genres: ['Techno'],
          conduct: false,
          timestamp: Date.now(),
        }),
      );

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'restore-community');
      fixture.detectChanges();
      await waitForVettingResource();
      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isBooleanRadioSelected('notACop', 'true')).toBe(
        true,
      );
      expect(await harness.isCheckboxOptionSelected('genres', 0)).toBe(true);
      expect(await harness.isCheckboxOptionSelected('genres', 1)).toBe(false);
    });

    it('keeps drafts isolated when switching between vetting communities on the same route', async () => {
      await harness.setReferral('Original community answer');
      fixture.detectChanges();

      fixture.componentRef.setInput('id', 'other-community');
      fixture.detectChanges();
      await waitForVettingResource();

      const originalDraft = readStoredDraft('vetting-form-org-123');
      expect(originalDraft['referral']).toBe('Original community answer');
      expect(sessionStorage.getItem('vetting-form-other-community')).toBeNull();

      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await waitForVettingResource();

      const restoredField = fixture.componentInstance.getField('referral');
      expect(restoredField?.().value()).toBe('Original community answer');
      expect(sessionStorage.getItem('vetting-form-other-community')).toBeNull();
    });
  });

  describe('Optional boolean answers', () => {
    // Rebuilds the fixture against a community whose only boolean question is
    // OPTIONAL, plus a required text question so the form can be submitted.
    // No code of conduct → conduct agreement is not required.
    async function setupOptionalBooleanCommunity(): Promise<void> {
      fixture.destroy();
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'optbool-community',
        name: 'Optional Boolean Community',
        status: 'published',
        vettingQuestions: [
          {
            id: 'referral',
            question: 'How did you hear about us?',
            type: 'text',
            required: true,
          },
          {
            id: 'attended',
            question: 'Have you attended one of our events before?',
            type: 'boolean',
            required: false,
          },
        ],
      });

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'optbool-community');
      fixture.detectChanges();
      await waitForVettingResource();
      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      await harness.setReferral('Friend recommended me');
      fixture.detectChanges();
      await fixture.whenStable();
    }

    function submittedAnswers(): Record<string, unknown> {
      const createMock = (appsServiceMock as {create: ReturnType<typeof vi.fn>})
        .create;
      expect(createMock).toHaveBeenCalledTimes(1);
      const arg = createMock.mock.calls[0][0] as {
        answers: Record<string, unknown>;
      };
      return arg.answers;
    }

    it('omits an untouched optional boolean instead of sending false', async () => {
      await setupOptionalBooleanCommunity();

      expect(await harness.isSubmitDisabled()).toBe(false);

      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();

      const answers = submittedAnswers();
      // The untouched optional boolean must NOT appear at all — an omitted key
      // is the only way the backend records it as "unanswered" (its answers
      // validator has no null branch).
      expect(answers).not.toHaveProperty('attended');
      expect(answers['referral']).toBe('Friend recommended me');
      expect(answers['source']).toBe('web');
    });

    it('sends false when the optional boolean No radio is explicitly chosen', async () => {
      await setupOptionalBooleanCommunity();

      await harness.clickBooleanRadio('attended', 'false');
      fixture.detectChanges();
      await fixture.whenStable();

      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();

      const answers = submittedAnswers();
      expect(answers['attended']).toBe(false);
    });

    it('sends true when the optional boolean Yes radio is explicitly chosen', async () => {
      await setupOptionalBooleanCommunity();

      await harness.clickBooleanRadio('attended', 'true');
      fixture.detectChanges();
      await fixture.whenStable();

      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();

      const answers = submittedAnswers();
      expect(answers['attended']).toBe(true);
    });

    it('still blocks submission when a required boolean is left untouched', async () => {
      fixture.destroy();
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'reqbool-community',
        name: 'Required Boolean Community',
        status: 'published',
        vettingQuestions: [
          {
            id: 'referral',
            question: 'How did you hear about us?',
            type: 'text',
            required: true,
          },
          {
            id: 'notACop',
            question: 'Are you not a cop?',
            type: 'boolean',
            required: true,
          },
        ],
      });

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'reqbool-community');
      fixture.detectChanges();
      await waitForVettingResource();
      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      await harness.setReferral('Friend recommended me');
      fixture.detectChanges();
      await fixture.whenStable();

      // Required boolean untouched → form invalid → submit is a no-op.
      expect(await harness.isSubmitDisabled()).toBe(true);

      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();

      expect(
        (appsServiceMock as {create: ReturnType<typeof vi.fn>}).create,
      ).not.toHaveBeenCalled();
    });
  });

  describe('Form Submission', () => {
    beforeEach(async () => {
      await harness.setReferral('Friend recommended me');
      await harness.setWhyJoin(
        'I want to join to support the community and attend events. This is long enough.',
      );
      await harness.setSocials('@instagram');
      await harness.toggleConduct();
      fixture.detectChanges();
    });

    it('should submit application with correct data', async () => {
      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();

      expect(
        (appsServiceMock as {create: ReturnType<typeof vi.fn>}).create,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          answers: expect.objectContaining({
            referral: 'Friend recommended me',
            whyJoin:
              'I want to join to support the community and attend events. This is long enough.',
            socials: '@instagram',
            source: 'web',
          }) as unknown,
        }),
      );
    });

    it('should navigate to home after successful submission', async () => {
      // Just call onSubmit and wait for it to complete (including the 1500ms delay)
      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();

      expect(router.navigate).toHaveBeenCalledWith(['/']);
    });

    it('should not recreate the saved draft when the submitted form is torn down', async () => {
      sessionStorage.setItem(
        'vetting-form-org-123',
        JSON.stringify({
          referral: 'Existing draft',
          conduct: true,
          timestamp: Date.now(),
        }),
      );

      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();
      fixture.destroy();

      expect(sessionStorage.getItem('vetting-form-org-123')).toBeNull();
    });

    it('should set isSubmitting during submission', async () => {
      let resolvePromise: (value: unknown) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      (
        appsServiceMock as {create: ReturnType<typeof vi.fn>}
      ).create.mockReturnValueOnce(promise);

      const submitPromise = fixture.componentInstance.onSubmit();
      fixture.detectChanges();

      // Check loading state synchronously after calling onSubmit
      expect(fixture.componentInstance.isSubmitting()).toBe(true);

      resolvePromise!({});
      await submitPromise;
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.isSubmitting()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await harness.setReferral('Friend');
      await harness.setWhyJoin(
        'I want to join to support the community and attend events. This is long enough.',
      );
      await harness.toggleConduct();
      fixture.detectChanges();
    });

    it('should not submit if user is not logged in', async () => {
      // Clear previous mock calls from beforeEach
      vi.clearAllMocks();

      // Set user to null - this triggers questionsResource to reload
      (authServiceMock as {user: {set: (v: unknown) => void}}).user.set(null);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      // Try to submit - the component should check auth.currentUser()
      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        (appsServiceMock as {create: ReturnType<typeof vi.fn>}).create,
      ).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();

      // Error should be set - component checks currentUser() in onSubmit callback
      expect(fixture.componentInstance.errorMsg()).toContain(
        'You must be logged in',
      );
    });

    it('should display error message on API failure', async () => {
      const errorMessage = 'Failed to create application';
      (
        appsServiceMock as {create: ReturnType<typeof vi.fn>}
      ).create.mockRejectedValueOnce(new Error(errorMessage));

      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.errorMsg()).toBeTruthy();
      expect(fixture.componentInstance.errorMsg()).toContain(errorMessage);
    });

    it('should extract clean message from ConvexError', async () => {
      (
        appsServiceMock as {create: ReturnType<typeof vi.fn>}
      ).create.mockRejectedValueOnce(
        new ConvexError('You already have a pending application.'),
      );

      await fixture.componentInstance.onSubmit();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.componentInstance.errorMsg()).toBe(
        'You already have a pending application.',
      );
    });
  });

  describe('Existing Application Pre-Check', () => {
    it('blocks form rendering while organizer lookup is still loading', async () => {
      const loadingFixture = await setupQuestionsLoading();

      await manualChangeDetection(async () => {
        const loadingHarness =
          await TestbedHarnessEnvironment.harnessForFixture(
            loadingFixture,
            VettingComponentHarness,
          );

        expect(await loadingHarness.isGateLoadingStateVisible()).toBe(true);
        expect(await loadingHarness.isReferralInputVisible()).toBe(false);
        expect(await loadingHarness.isSubmitButtonVisible()).toBe(false);
        expect(await loadingHarness.isPendingStateVisible()).toBe(false);
        expect(await loadingHarness.isApprovedStateVisible()).toBe(false);
      });
    });

    it('blocks form rendering while the existing application gate is still loading', async () => {
      const loadingFixture = await setupExistingApplicationLoading();

      await manualChangeDetection(async () => {
        const loadingHarness =
          await TestbedHarnessEnvironment.harnessForFixture(
            loadingFixture,
            VettingComponentHarness,
          );

        expect(await loadingHarness.isGateLoadingStateVisible()).toBe(true);
        expect(await loadingHarness.isReferralInputVisible()).toBe(false);
        expect(await loadingHarness.isSubmitButtonVisible()).toBe(false);
        expect(await loadingHarness.isPendingStateVisible()).toBe(false);
        expect(await loadingHarness.isApprovedStateVisible()).toBe(false);
      });
    });

    it('shows a blocked state when the existing application check fails', async () => {
      existingApplicationError = new Error('status lookup failed');

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await waitForVettingResource();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isGateErrorStateVisible()).toBe(true);
      expect(await harness.getGateErrorStateText()).toContain(
        "couldn't check your application status",
      );
      expect(await harness.isReferralInputVisible()).toBe(false);
      expect(await harness.isSubmitButtonVisible()).toBe(false);
    });

    it('shows a blocked state when the community precheck fails before the application check can run', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockRejectedValue(new Error('community lookup failed'));

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await waitForVettingResource();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isGateErrorStateVisible()).toBe(true);
      expect(await harness.getGateErrorStateText()).toContain(
        "couldn't load this community's application status",
      );
      expect(await harness.isReferralInputVisible()).toBe(false);
      expect(await harness.isSubmitButtonVisible()).toBe(false);
      expect(await harness.getFormErrorText()).toBeNull();
    });

    it('should show pending state when user has a pending application', async () => {
      // Seed the subscription with a pending application
      existingApplicationDoc = {
        _id: 'app-123',
        _creationTime: Date.now(),
        userId: '123',
        status: 'pending',
        answers: {},
      };

      // Re-create the component so the subscription emits the new doc
      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isPendingStateVisible()).toBe(true);
      expect(await harness.isSubmitDisabled()).toBe(true); // form not shown
    });

    it('should show approved state when user has an approved application', async () => {
      existingApplicationDoc = {
        _id: 'app-456',
        _creationTime: Date.now(),
        userId: '123',
        status: 'approved',
        answers: {},
      };

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isApprovedStateVisible()).toBe(true);
      expect(await harness.isSubmitDisabled()).toBe(true); // form not shown
    });

    it('should show form when user has no existing application', async () => {
      // Default mock returns null - form should show
      expect(await harness.isPendingStateVisible()).toBe(false);
      expect(await harness.isApprovedStateVisible()).toBe(false);
      // Form elements should be present
      const formInstance = fixture.componentInstance.vettingForm();
      expect(formInstance).not.toBeNull();
    });

    it('reacts live when the existing-application subscription pushes an approval', async () => {
      // The base fixture already rendered the form from the null emission.
      expect(await harness.isApprovedStateVisible()).toBe(false);

      // Push a new value through the captured subscription callback WITHOUT
      // recreating the component — this exercises the injectQuery re-emit path
      // that resource() could never hit.
      emitExisting?.({
        _id: 'app-live',
        _creationTime: Date.now(),
        userId: '123',
        status: 'approved',
        answers: {},
      });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await harness.isApprovedStateVisible()).toBe(true);
    });

    it('reacts live when the existing-application subscription reports an error', async () => {
      // The base fixture rendered the form from the null emission.
      expect(await harness.isGateErrorStateVisible()).toBe(false);
      expect(await harness.isReferralInputVisible()).toBe(true);

      // Drive the subscription's error channel (injectQuery's `fail`) live.
      emitExistingError?.(new Error('status lookup failed'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(await harness.isGateErrorStateVisible()).toBe(true);
      expect(await harness.getGateErrorStateText()).toContain(
        "couldn't check your application status",
      );
      expect(await harness.isReferralInputVisible()).toBe(false);
    });

    it('should show rejected state when user has a rejected application', async () => {
      existingApplicationDoc = {
        _id: 'app-789',
        _creationTime: Date.now(),
        userId: '123',
        status: 'rejected',
        denyReason: 'We could not verify your eligibility.',
        answers: {},
      };

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isRejectedStateVisible()).toBe(true);
      expect(await harness.getRejectedStateText()).toContain(
        'was not accepted',
      );
      expect(await harness.getRejectedStateText()).toContain(
        'revise your answers and re-submit',
      );
      expect(await harness.getRejectedStateReasonText()).toContain(
        'could not verify',
      );
      expect(fixture.componentInstance.existingApplication()?.status).toBe(
        'rejected',
      );
      expect(await harness.isReferralInputVisible()).toBe(true);
      expect(await harness.isSubmitButtonVisible()).toBe(true);

      // Submit button should say "Re-submit Application" for rejected users
      expect(await harness.getSubmitButtonText()).toContain(
        'Re-submit Application',
      );

      await harness.setReferral('Friend recommended me');
      await harness.setWhyJoin(
        'I want to join to support the community and attend events. This is long enough.',
      );
      await harness.setSocials('@instagram');
      await harness.toggleConduct();
      fixture.detectChanges();

      expect(await harness.isSubmitDisabled()).toBe(false);
    });
  });

  describe('Slug resolution', () => {
    it('loads community using a slug (not a Convex ID)', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'org-123',
        name: 'Test Community',
        status: 'published',
        slug: 'test-community',
        vettingQuestions: [
          {
            id: 'referral',
            question: 'How did you hear about us?',
            type: 'text',
            required: true,
          },
        ],
      });

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'test-community');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(
        (communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>})
          .getBySlugOrId,
      ).toHaveBeenCalledWith('test-community');

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );
      expect(await harness.isReferralInputVisible()).toBe(true);
    });

    it('shows unavailable state when slug resolves to null (community not found)', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue(null);

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'unknown-slug');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isUnavailableStateVisible()).toBe(true);
      expect(
        (await harness.getUnavailableStateText())?.toLowerCase(),
      ).toContain('not found');
      expect(await harness.isSubmitDisabled()).toBe(true);
    });
  });

  describe('Community availability', () => {
    it('shows unavailable state when community is draft', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'org-123',
        name: 'Draft Community',
        status: 'draft',
        vettingQuestions: [
          {id: 'q1', question: 'Why?', type: 'text', required: true},
        ],
      });

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isUnavailableStateVisible()).toBe(true);
      expect(
        (await harness.getUnavailableStateText())?.toLowerCase(),
      ).toContain("isn't accepting");
      expect(await harness.isSubmitDisabled()).toBe(true);
    });

    it('shows unavailable state when community has no vetting questions', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'org-123',
        name: 'No Questions Community',
        status: 'published',
        vettingQuestions: [],
      });

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isUnavailableStateVisible()).toBe(true);
      expect(await harness.isSubmitDisabled()).toBe(true);
    });

    it('shows rejection notice alongside unavailable state when the community is unavailable', async () => {
      (
        communitiesServiceMock as {getBySlugOrId: ReturnType<typeof vi.fn>}
      ).getBySlugOrId.mockResolvedValue({
        _id: 'org-123',
        name: 'Draft Community',
        status: 'draft',
        vettingQuestions: [
          {id: 'q1', question: 'Why?', type: 'text', required: true},
        ],
      });

      // questionsResource still resolves organizerId even when the community is
      // unavailable (component returns community._id for draft/no-question
      // communities), so the query subscribes and emits the rejected doc.
      existingApplicationDoc = {
        _id: 'app-999',
        _creationTime: Date.now(),
        userId: '123',
        status: 'rejected',
        denyReason: 'Eligibility was not verified.',
        answers: {},
      };

      fixture = TestBed.createComponent(VettingComponent);
      fixture.componentRef.setInput('id', 'org-123');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      harness = await TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        VettingComponentHarness,
      );

      expect(await harness.isRejectedStateVisible()).toBe(true);
      expect(await harness.getRejectedStateText()).toContain(
        'was not accepted',
      );
      expect(await harness.getRejectedStateReasonText()).toContain(
        'Eligibility was not verified',
      );
      expect(await harness.isUnavailableStateVisible()).toBe(true);
      expect(await harness.isReferralInputVisible()).toBe(false);
      expect(await harness.isSubmitButtonVisible()).toBe(false);
    });
  });
});
