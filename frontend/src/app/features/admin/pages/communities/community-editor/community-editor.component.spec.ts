import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {
  ActivatedRoute,
  convertToParamMap,
  type ParamMap,
} from '@angular/router';
import {provideRouter} from '@angular/router';
import {BehaviorSubject} from 'rxjs';
import {vi, describe, it, expect, beforeEach} from 'vitest';

import {AdminCommunityEditorComponent} from './community-editor.component';
import {AdminCommunityEditorComponentHarness} from './community-editor.component.harness';
import {CommunitiesService} from '@/core/services/communities.service';
import {CONVEX} from 'convex-angular';
import {AuthService} from '@/core/services/auth.service';
import {type Id} from '@convex/_generated/dataModel';
import {toast} from 'ngx-sonner';

type MockAuthService = Pick<AuthService, 'currentUser' | 'userRole'>;
type MockActivatedRoute = Pick<ActivatedRoute, 'paramMap' | 'queryParamMap'>;

@Component({
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class CommunitiesRouteStubComponent {}

describe('AdminCommunityEditorComponent', () => {
  let fixture: ComponentFixture<AdminCommunityEditorComponent>;
  let component: AdminCommunityEditorComponent;
  let authServiceMock: MockAuthService;
  let activatedRouteMock: MockActivatedRoute;
  let communitiesServiceMock: {
    get: ReturnType<typeof vi.fn>;
    getAdmin: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  let convexClientMock: {
    mutation: ReturnType<typeof vi.fn>;
    action: ReturnType<typeof vi.fn>;
  };
  let routeParamMap$: BehaviorSubject<ParamMap>;
  let routeQueryParamMap$: BehaviorSubject<ParamMap>;

  beforeEach(async () => {
    vi.clearAllMocks();

    authServiceMock = {
      currentUser: signal(null),
      userRole: signal('user'),
    };

    routeParamMap$ = new BehaviorSubject(convertToParamMap({}));
    routeQueryParamMap$ = new BehaviorSubject(convertToParamMap({}));

    activatedRouteMock = {
      paramMap: routeParamMap$.asObservable(),
      queryParamMap: routeQueryParamMap$.asObservable(),
    };

    communitiesServiceMock = {
      get: vi.fn().mockResolvedValue(null),
      getAdmin: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
    };

    convexClientMock = {
      mutation: vi.fn().mockResolvedValue(undefined),
      // Default action returns a stub account-session secret so the
      // embedded StripeConnectEmbedComponent's fetchClientSecret
      // callback resolves cleanly during tests that render the embed.
      action: vi.fn().mockResolvedValue({clientSecret: 'seccs_test'}),
    };
    await TestBed.configureTestingModule({
      imports: [AdminCommunityEditorComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([
          {path: 'admin/communities', component: CommunitiesRouteStubComponent},
        ]),
        {provide: AuthService, useValue: authServiceMock},
        {provide: CommunitiesService, useValue: communitiesServiceMock},
        {provide: CONVEX, useValue: convexClientMock},
        {provide: ActivatedRoute, useValue: activatedRouteMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminCommunityEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('communityModel() defaults include description as empty string and isPublicDirectory as false', () => {
    const model = component.communityModel();
    expect(model.description).toBe('');
    expect(model.isPublicDirectory).toBe(false);
    expect(model.status).toBe('draft');
  });

  it('togglePublicDirectory() flips isPublicDirectory from false to true', () => {
    expect(component.communityModel().isPublicDirectory).toBe(false);
    component.togglePublicDirectory();
    expect(component.communityModel().isPublicDirectory).toBe(true);
  });

  it('togglePublicDirectory() flips isPublicDirectory back to false on second call', () => {
    component.togglePublicDirectory();
    expect(component.communityModel().isPublicDirectory).toBe(true);
    component.togglePublicDirectory();
    expect(component.communityModel().isPublicDirectory).toBe(false);
  });

  it('displaySlug derives slug from name in create mode', () => {
    component.communityModel.update((m) => ({...m, name: 'My Community Name'}));
    expect(component.displaySlug()).toBe('my-community-name');
  });

  it('displaySlug returns user slug when manually edited', () => {
    component.communityModel.update((m) => ({
      ...m,
      name: 'Initial Name',
      slug: 'custom-slug',
    }));
    // slug differs from auto-generated 'initial-name', so isSlugManuallyEdited is true
    expect(component.isSlugManuallyEdited()).toBe(true);
    expect(component.displaySlug()).toBe('custom-slug');

    // Changing name does not overwrite the manual slug
    component.communityModel.update((m) => ({...m, name: 'New Name'}));
    expect(component.displaySlug()).toBe('custom-slug');
  });

  it('displaySlug tracks name changes until slug is manually set', () => {
    component.communityModel.update((m) => ({...m, name: 'First'}));
    expect(component.displaySlug()).toBe('first');

    component.communityModel.update((m) => ({...m, name: 'Second'}));
    expect(component.displaySlug()).toBe('second');

    // User manually types a slug
    component.communityModel.update((m) => ({...m, slug: 'my-custom'}));
    expect(component.displaySlug()).toBe('my-custom');

    // Name change no longer affects displaySlug
    component.communityModel.update((m) => ({...m, name: 'Third'}));
    expect(component.displaySlug()).toBe('my-custom');
  });

  it('starts Stripe account creation when Connect with Stripe is clicked', async () => {
    component.communityId.set('org_123' as Id<'organizers'>);
    component.stripeConnectedAccountId.set(null);
    component.organizerPaymentReady.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminCommunityEditorComponentHarness,
    );

    await harness.clickConnectWithStripe();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(convexClientMock.action).toHaveBeenCalled();
  });

  it('slug form field auto-populates when name is entered in create mode', async () => {
    component.communityModel.update((m) => ({...m, name: 'Test Community'}));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.communityModel().slug).toBe('test-community');
  });

  it('slug form field updates as name changes while not manually edited', async () => {
    component.communityModel.update((m) => ({...m, name: 'First Name'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.communityModel().slug).toBe('first-name');

    component.communityModel.update((m) => ({...m, name: 'Second Name'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.communityModel().slug).toBe('second-name');
  });

  it('slug form field stops auto-updating after user manually edits it', async () => {
    component.communityModel.update((m) => ({...m, name: 'Initial Name'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.communityModel().slug).toBe('initial-name');

    // User manually edits the slug
    component.communityModel.update((m) => ({...m, slug: 'my-custom-slug'}));
    fixture.detectChanges();
    await fixture.whenStable();

    // Name change should not overwrite the manual slug
    component.communityModel.update((m) => ({...m, name: 'Changed Name'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.communityModel().slug).toBe('my-custom-slug');
  });

  it('slug form field resumes auto-updating when user clears it', async () => {
    component.communityModel.update((m) => ({...m, name: 'My Community'}));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.communityModel().slug).toBe('my-community');

    // User clears the slug
    component.communityModel.update((m) => ({...m, slug: ''}));
    fixture.detectChanges();
    await fixture.whenStable();

    // Effect should re-populate from name
    expect(component.communityModel().slug).toBe('my-community');
  });

  it('form is valid once name is entered in create mode (slug auto-populates)', async () => {
    // Initially invalid because required fields are empty
    expect(component.f().invalid()).toBe(true);

    component.communityModel.update((m) => ({...m, name: 'My Community'}));
    fixture.detectChanges();
    await fixture.whenStable();

    // Slug auto-populated — form should now be valid
    expect(component.communityModel().slug).toBe('my-community');
    expect(component.f().invalid()).toBe(false);
  });

  it('rejects manual slugs with spaces or punctuation before create', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminCommunityEditorComponentHarness,
    );

    await harness.setName('QA Invalid Slug Collective');
    await harness.setSlug('Bad Slug!!');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.f.slug().invalid()).toBe(true);
    expect(
      component.f
        .slug()
        .errors()
        .some((e) => e.kind === 'communitySlug'),
    ).toBe(true);
    expect(component.isSlugInvalid()).toBe(true);
    expect(component.isSubmitDisabled()).toBe(true);

    await component.onSubmit();

    expect(communitiesServiceMock.create).not.toHaveBeenCalled();
  });

  it('slug is not auto-populated when name is empty', async () => {
    // Name is empty by default
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.communityModel().slug).toBe('');
  });

  it('loads an existing community when the route id changes', async () => {
    const loadedCommunity = {
      _id: 'org_123' as Id<'organizers'>,
      _creationTime: Date.now(),
      name: 'Loaded Community',
      slug: 'loaded-community',
      email: 'loaded@example.com',
      contactInfo: 'Discord only',
      description: 'Loaded from the resource',
      isPublicDirectory: true,
      status: 'published',
      vettingQuestions: [
        {
          id: 'q1',
          question: 'Why join?',
          type: 'text',
          required: true,
          options: ['A', 'B'],
        },
      ],
      stripeConnectedAccountId: 'acct_123',
      stripeOnboardingStatus: 'complete',
      stripeChargesEnabled: true,
      stripePayoutsEnabled: true,
      organizerPaymentReady: true,
      isPlatformOrganizer: true,
    } as NonNullable<Awaited<ReturnType<CommunitiesService['getAdmin']>>>;

    communitiesServiceMock.getAdmin.mockResolvedValueOnce(loadedCommunity);

    fixture.componentRef.setInput('id', 'org_123');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(communitiesServiceMock.getAdmin).toHaveBeenCalledWith('org_123');
    expect(component.communityModel().name).toBe('Loaded Community');
    expect(component.stripeConnectedAccountId()).toBe('acct_123');
    expect(component.stripeOnboardingStatus()).toBe('complete');
    expect(component.stripeChargesEnabled()).toBe(true);
    expect(component.stripePayoutsEnabled()).toBe(true);
    expect(component.organizerPaymentReady()).toBe(true);
    expect(component.isPlatformOrganizer()).toBe(true);
    expect(component.isEditMode()).toBe(true);
  });

  it('canPublishCommunity() requires edit mode and payment readiness', () => {
    expect(component.canPublishCommunity()).toBe(false);

    component.communityId.set('org_123' as Id<'organizers'>);
    expect(component.canPublishCommunity()).toBe(false);

    component.organizerPaymentReady.set(true);
    expect(component.canPublishCommunity()).toBe(true);
  });

  it('BRA-422: platform organizer toggle immediately unblocks publish', async () => {
    component.communityId.set('org_123' as Id<'organizers'>);
    component.communityModel.set({
      name: 'Platform Community',
      slug: 'platform-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'draft',
      vettingQuestions: [
        {
          id: 'q1',
          question: 'Why join?',
          type: 'text',
          required: true,
          options: [],
          optionsString: '',
        },
      ],
    });

    expect(component.organizerPaymentReady()).toBe(false);
    expect(component.canSetPublishedStatus()).toBe(false);

    await component.togglePlatformOrganizer();

    expect(component.isPlatformOrganizer()).toBe(true);
    expect(component.organizerPaymentReady()).toBe(true);
    expect(component.canSetPublishedStatus()).toBe(true);

    component.setPublicationStatus('published');
    await component.onSubmit();

    expect(communitiesServiceMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'org_123',
        status: 'published',
      }),
    );
  });

  it('BRA-422: platform organizer toggle recomputes readiness when disabled', async () => {
    component.communityId.set('org_123' as Id<'organizers'>);
    component.isPlatformOrganizer.set(true);
    component.organizerPaymentReady.set(true);
    component.communityModel.set({
      name: 'Platform Community',
      slug: 'platform-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'draft',
      vettingQuestions: [
        {
          id: 'q1',
          question: 'Why join?',
          type: 'text',
          required: true,
          options: [],
          optionsString: '',
        },
      ],
    });

    expect(component.canSetPublishedStatus()).toBe(true);

    await component.togglePlatformOrganizer();

    expect(component.isPlatformOrganizer()).toBe(false);
    expect(component.organizerPaymentReady()).toBe(false);
    expect(component.canSetPublishedStatus()).toBe(false);

    component.setPublicationStatus('published');
    expect(component.communityModel().status).toBe('draft');
    expect(communitiesServiceMock.update).not.toHaveBeenCalled();
  });

  it('canSetPublishedStatus() requires Stripe setup and at least one vetting question', () => {
    component.communityId.set('org_123' as Id<'organizers'>);
    component.organizerPaymentReady.set(true);
    expect(component.canSetPublishedStatus()).toBe(false);

    component.addQuestion({
      id: 'q1',
      question: 'Why join?',
      type: 'text',
      required: true,
    });
    expect(component.canSetPublishedStatus()).toBe(true);
  });

  it('marks the form invalid when a new vetting question is added without required content', () => {
    component.communityModel.set({
      name: 'Test Community',
      slug: 'test-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'draft',
      vettingQuestions: [],
    });

    expect(component.f().invalid()).toBe(false);

    component.addQuestion({
      id: 'q1',
      question: '',
      type: 'text',
      required: true,
    });

    expect(component.f().invalid()).toBe(true);
    expect(component.f.vettingQuestions[0].question().invalid()).toBe(true);
  });

  it('adds a visible vetting question row from the Add Question button', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminCommunityEditorComponentHarness,
    );

    expect(await harness.isVettingEmptyVisible()).toBe(true);
    expect(await harness.getVettingQuestionCount()).toBe(0);

    await harness.clickAddQuestion();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isVettingEmptyVisible()).toBe(false);
    expect(await harness.getVettingQuestionCount()).toBe(1);
    expect(component.communityModel().vettingQuestions).toHaveLength(1);
    expect(component.f.vettingQuestions[0].question().invalid()).toBe(true);
  });

  it('lets the added vetting question row update the form model', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminCommunityEditorComponentHarness,
    );

    await harness.clickAddQuestion();
    await harness.setQuestionText(0, 'Why do you want to join?');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.communityModel().vettingQuestions[0].question).toBe(
      'Why do you want to join?',
    );
    expect(component.f.vettingQuestions[0].question().invalid()).toBe(false);
  });

  it('applies email validation after initialization when the user later enters an invalid email', () => {
    component.communityModel.set({
      name: 'Test Community',
      slug: 'test-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'draft',
      vettingQuestions: [],
    });

    expect(component.f.email().invalid()).toBe(false);

    component.communityModel.update((model) => ({
      ...model,
      email: 'not-an-email',
    }));

    expect(component.f.email().invalid()).toBe(true);
  });

  it('setPublicationStatus does not switch to published without vetting questions', () => {
    component.communityId.set('org_123' as Id<'organizers'>);
    component.organizerPaymentReady.set(true);
    component.setPublicationStatus('published');

    expect(component.communityModel().status).toBe('draft');
  });

  it('disables save when a published community has no vetting questions', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminCommunityEditorComponentHarness,
    );
    component.communityModel.set({
      name: 'Test Community',
      slug: 'test-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'published',
      vettingQuestions: [],
    });
    component.communityId.set('org_123' as Id<'organizers'>);
    component.organizerPaymentReady.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isPublished()).toBe(true);
    expect(await harness.isSaveDisabled()).toBe(true);
  });

  it('disables save when a published community is missing Stripe readiness', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminCommunityEditorComponentHarness,
    );
    component.communityModel.set({
      name: 'Test Community',
      slug: 'test-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'published',
      vettingQuestions: [
        {
          id: 'q1',
          question: 'Why join?',
          type: 'text',
          required: true,
          options: [],
          optionsString: '',
        },
      ],
    });
    component.communityId.set('org_123' as Id<'organizers'>);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isPublished()).toBe(true);
    expect(await harness.isSaveDisabled()).toBe(true);
  });

  it('onSubmit sends the current publication status to the service', async () => {
    component.communityModel.set({
      name: 'Test Community',
      slug: 'test-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'published',
      vettingQuestions: [
        {
          id: 'q1',
          question: 'Why join?',
          type: 'text',
          required: true,
          options: [],
          optionsString: '',
        },
      ],
    });
    component.communityId.set('org_123' as Id<'organizers'>);
    component.organizerPaymentReady.set(true);

    await component.onSubmit();

    expect(communitiesServiceMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'org_123',
        status: 'published',
      }),
    );
  });

  it('onSubmit blocks publishing when there are no vetting questions', async () => {
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    component.communityModel.set({
      name: 'Test Community',
      slug: 'test-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'published',
      vettingQuestions: [],
    });
    component.communityId.set('org_123' as Id<'organizers'>);
    component.organizerPaymentReady.set(true);

    await component.onSubmit();

    expect(communitiesServiceMock.update).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      'Add at least one vetting question before publishing.',
    );
    toastSpy.mockRestore();
  });

  it('onSubmit blocks publishing when Stripe setup is incomplete', async () => {
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    component.communityModel.set({
      name: 'Test Community',
      slug: 'test-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'published',
      vettingQuestions: [
        {
          id: 'q1',
          question: 'Why join?',
          type: 'text',
          required: true,
          options: [],
          optionsString: '',
        },
      ],
    });
    component.communityId.set('org_123' as Id<'organizers'>);

    await component.onSubmit();

    expect(communitiesServiceMock.update).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      'Stripe Connect onboarding or platform payouts are required before publishing.',
    );
    toastSpy.mockRestore();
  });

  it('onSubmit creates draft communities by default in create mode', async () => {
    component.communityModel.set({
      name: 'Draft Community',
      slug: 'draft-community',
      email: '',
      contactInfo: '',
      description: '',
      isPublicDirectory: false,
      status: 'draft',
      vettingQuestions: [],
    });

    await component.onSubmit();

    expect(communitiesServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
      }),
    );
  });

  describe('whitespace-only name (BRA-408)', () => {
    it('form is invalid when name is whitespace-only', async () => {
      component.communityModel.update((m) => ({
        ...m,
        name: '   ',
        slug: 'my-community',
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.f().invalid()).toBe(true);
    });

    it('save button is disabled when name is whitespace-only', async () => {
      component.communityModel.update((m) => ({
        ...m,
        name: '   ',
        slug: 'my-community',
      }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.isSubmitDisabled()).toBe(true);
    });

    it('does not call communitiesService.create when name is whitespace-only', async () => {
      component.communityModel.set({
        name: '   ',
        slug: 'my-community',
        email: '',
        contactInfo: '',
        description: '',
        isPublicDirectory: false,
        status: 'draft',
        vettingQuestions: [],
      });

      await component.onSubmit();

      expect(communitiesServiceMock.create).not.toHaveBeenCalled();
    });

    it('trims name before persisting when valid non-whitespace value provided', async () => {
      component.communityModel.set({
        name: 'My Community',
        slug: 'my-community',
        email: '',
        contactInfo: '',
        description: '',
        isPublicDirectory: false,
        status: 'draft',
        vettingQuestions: [],
      });

      await component.onSubmit();

      expect(communitiesServiceMock.create).toHaveBeenCalledWith(
        expect.objectContaining({name: 'My Community'}),
      );
    });
  });

  describe('BRA-297: toast on backend save failure', () => {
    it('calls toast.error with error message when update throws', async () => {
      const errorMessage =
        'Published communities must have at least one vetting question';
      communitiesServiceMock.update.mockRejectedValue(new Error(errorMessage));

      const toastErrorSpy = vi.spyOn(toast, 'error');

      // Set up the form in a valid edit-mode state
      component.communityModel.set({
        name: 'Test Community',
        slug: 'test-community',
        email: '',
        contactInfo: '',
        description: '',
        isPublicDirectory: false,
        status: 'published',
        vettingQuestions: [
          {
            id: 'q1',
            question: 'Why join?',
            type: 'text',
            required: true,
            options: [],
            optionsString: '',
          },
        ],
      });
      // Force edit mode + satisfy canPublishCommunity() so the form reaches the backend call
      component.communityId.set('org-abc' as Id<'organizers'>);
      component.organizerPaymentReady.set(true);

      await component.onSubmit();

      expect(toastErrorSpy).toHaveBeenCalledWith(errorMessage);
    });
  });
});
