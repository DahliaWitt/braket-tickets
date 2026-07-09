import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {
  applyEach,
  email,
  form,
  FormField,
  required,
  schema,
  validate,
  type MaybeFieldTree,
} from '@angular/forms/signals';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {
  CommunitiesService,
  type VettingQuestion,
} from '@/core/services/communities.service';
import {AuthService} from '@/core/services/auth.service';
import {toast} from 'ngx-sonner';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {ZardSelectComponent} from '@ui/components/primitives/select/select.component';
import {ZardSelectItemComponent} from '@ui/components/primitives/select/select-item.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {type Doc, type Id} from '@convex/_generated/dataModel';
import {api} from '@convex/_generated/api';
import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';
import {logger} from '@/utils/logger';
import {
  StripeConnectEmbedComponent,
  type StripeConnectComponentKind,
} from '@/features/admin/components/stripe-connect/stripe-connect-embed.component';
import {generateId} from '@ui/utils/merge-classes';
import {safeResourceValue} from '@/utils/resource';
import {
  isSignalFormFieldInvalid,
  notBlank,
  signalFormFieldHasError,
} from '@/utils/signal-form';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {
  generateCommunitySlug,
  isCommunitySlug,
} from '@shared/domain/community-slug';
import {
  normalizeVettingQuestionsForSave,
  addVettingQuestion,
  removeVettingQuestion,
  needsVettingOptions,
  type VettingQuestionFormValue,
} from '../../community-admin-settings/community-admin-settings.helpers';
import {readInputChecked, readInputValue} from '@ui/utils/dom-event';

type StripeOnboardingStatus = NonNullable<
  Doc<'organizers'>['stripeOnboardingStatus']
>;

const vettingQuestionSchema = schema<VettingQuestionFormValue>((question) => {
  required(question.question);
  required(question.type);
});

const COMMUNITY_SLUG_ERROR =
  'Slug can use lowercase letters, numbers, and single hyphens only.';

@Component({
  selector: 'app-admin-community-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormField,
    ZardButtonComponent,
    ZardIconComponent,
    ZardCardComponent,
    ZardSkeletonComponent,
    ZardSelectComponent,
    ZardSelectItemComponent,
    ZardInputDirective,
    StripeConnectEmbedComponent,
    EmptyStateComponent,
  ],
  templateUrl: './community-editor.component.html',
})
export class AdminCommunityEditorComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private communitiesService = inject(CommunitiesService);
  private convex = injectConvex();
  private auth = inject(AuthService);
  private browser = inject(BrowserPlatformService);

  readonly id = input<string | undefined>();

  private readonly routeCommunityId = computed(() => this.id() ?? null);

  readonly communityModel = signal({
    name: '',
    slug: '',
    email: '',
    contactInfo: '',
    description: '',
    isPublicDirectory: false,
    status: 'draft' as CommunityPublicationStatus,
    vettingQuestions: [] as VettingQuestionFormValue[],
  });

  f = form(this.communityModel, (f) => {
    required(f.name);
    notBlank(f.name);
    required(f.slug);
    validate(f.slug, ({value}) => {
      const slug = value();
      if (!slug) return undefined;
      return isCommunitySlug(slug)
        ? undefined
        : {kind: 'communitySlug', message: COMMUNITY_SLUG_ERROR};
    });
    email(f.email);
    applyEach(f.vettingQuestions, vettingQuestionSchema);
  });

  readonly submitted = signal(false);
  readonly isSaving = signal(false);
  readonly communityId = signal<Id<'organizers'> | null>(null);

  readonly isEditMode = computed(() => !!this.communityId());

  // Stripe Connect state
  readonly stripeConnectedAccountId = signal<string | null>(null);
  readonly stripeOnboardingStatus = signal<StripeOnboardingStatus | null>(null);
  readonly stripeChargesEnabled = signal<boolean | null>(null);
  readonly stripePayoutsEnabled = signal<boolean | null>(null);
  readonly isStripeActionLoading = signal(false);
  readonly isCheckingStripeStatus = signal(false);
  readonly stripeError = signal<string | null>(null);
  readonly organizerPaymentReady = signal(false);
  readonly canPublishCommunity = computed(
    () => this.isEditMode() && this.organizerPaymentReady(),
  );
  readonly hasVettingQuestions = computed(
    () => this.communityModel().vettingQuestions.length > 0,
  );
  readonly canSetPublishedStatus = computed(
    () => this.canPublishCommunity() && this.hasVettingQuestions(),
  );
  readonly hasBlockedPublishedState = computed(
    () =>
      this.communityModel().status === 'published' &&
      !this.canSetPublishedStatus(),
  );
  readonly isSubmitDisabled = computed(
    () =>
      this.f().invalid() || this.isSaving() || this.hasBlockedPublishedState(),
  );

  // Platform organizer state
  readonly isPlatformOrganizer = signal(false);
  readonly isPlatformOrganizerSaving = signal(false);
  readonly platformOrganizerError = signal<string | null>(null);

  // Root admin check
  readonly isRootAdmin = computed(() => this.auth.userRole() === 'root_admin');

  private readonly communityResource = resource({
    params: () => {
      const id = this.routeCommunityId();
      return id ? {id: id as Id<'organizers'>} : undefined;
    },
    loader: async ({params}) => {
      try {
        const community = await this.communitiesService.getAdmin(params.id);
        return community;
      } catch (error) {
        logger.error('Failed to load community', error);
        throw error;
      }
    },
  });

  private readonly missingCommunityRedirect = effect(() => {
    const community = safeResourceValue(this.communityResource);
    if (
      this.isEditMode() &&
      this.communityResource.status() === 'resolved' &&
      community === null
    ) {
      void this.router.navigate(['/admin/communities']);
    }
  });
  readonly isLoading = computed(
    () => this.communityResource.status() === 'loading',
  );

  /** Derived slug for create mode: auto-generates from name unless user has edited it */
  readonly autoSlug = computed(() =>
    generateCommunitySlug(this.communityModel().name || ''),
  );

  /**
   * Tracks the last slug value written programmatically by the auto-populate effect,
   * so we can distinguish auto-written values from user-typed ones.
   */
  private readonly _lastAutoSlug = signal('');

  readonly isSlugManuallyEdited = computed(
    () =>
      !this.isEditMode() &&
      this.communityModel().slug !== '' &&
      this.communityModel().slug !== this.autoSlug(),
  );

  isFieldInvalid<T>(field: MaybeFieldTree<T>): boolean {
    return isSignalFormFieldInvalid(field, this.submitted());
  }

  isSlugInvalid(): boolean {
    return isSignalFormFieldInvalid(this.f.slug, this.submitted(), {
      includeDirty: true,
    });
  }

  hasError<T>(field: MaybeFieldTree<T>, errorKind: string): boolean {
    return signalFormFieldHasError(field, errorKind);
  }

  /** Derived slug value: in create mode, auto-generates from name unless manually edited */
  readonly displaySlug = computed(() => {
    if (this.isEditMode()) return this.communityModel().slug;
    if (this.isSlugManuallyEdited()) return this.communityModel().slug;
    return this.autoSlug();
  });

  constructor() {
    effect(() => {
      const routeCommunityId = this.routeCommunityId();
      this.communityId.set(
        routeCommunityId ? (routeCommunityId as Id<'organizers'>) : null,
      );
    });

    // Auto-populate the slug form field from the name in create mode, unless
    // the user has manually typed a different slug. _lastAutoSlug tracks the
    // last programmatically-set value so name changes keep updating the slug
    // while a manual edit locks the slug in place.
    effect(() => {
      if (this.isEditMode()) return;
      const name = this.communityModel().name;
      if (!name) return;
      const auto = this.autoSlug();
      const current = this.communityModel().slug;
      const lastAuto = untracked(() => this._lastAutoSlug());
      if ((current === '' || current === lastAuto) && current !== auto) {
        this._lastAutoSlug.set(auto);
        this.communityModel.update((m) => ({...m, slug: auto}));
      }
    });

    effect(() => {
      const community = safeResourceValue(this.communityResource);
      if (!community) return;

      const status =
        community.status ??
        (community.vettingQuestions?.length ? 'published' : 'draft');
      this.communityModel.set({
        name: community.name,
        slug: community.slug || '',
        email: community.email || '',
        contactInfo: community.contactInfo || '',
        description: community.description || '',
        isPublicDirectory: community.isPublicDirectory ?? false,
        status,
        vettingQuestions: (community.vettingQuestions || []).map((q) => ({
          id: q.id,
          question: q.question,
          type: q.type,
          required: q.required,
          options: q.options || [],
          optionsString: q.options?.join(', ') || '',
        })),
      });
      this.stripeConnectedAccountId.set(
        community.stripeConnectedAccountId ?? null,
      );
      this.stripeOnboardingStatus.set(community.stripeOnboardingStatus ?? null);
      this.stripeChargesEnabled.set(community.stripeChargesEnabled ?? null);
      this.stripePayoutsEnabled.set(community.stripePayoutsEnabled ?? null);
      this.organizerPaymentReady.set(community.organizerPaymentReady ?? false);
      this.isPlatformOrganizer.set(community.isPlatformOrganizer ?? false);
    });
  }

  addQuestion(data?: VettingQuestion) {
    if (!data) {
      this.communityModel.update((m) => ({
        ...m,
        vettingQuestions: addVettingQuestion(m.vettingQuestions),
      }));
      return;
    }

    this.communityModel.update((m) => ({
      ...m,
      vettingQuestions: [
        ...m.vettingQuestions,
        {
          id: data?.id || generateId(),
          question: data?.question || '',
          type: data?.type || 'text',
          required: data?.required ?? true,
          options: data?.options || [],
          optionsString: data?.options?.join(', ') || '',
        },
      ],
    }));
  }
  removeQuestion(index: number) {
    this.communityModel.update((m) => ({
      ...m,
      vettingQuestions: removeVettingQuestion(m.vettingQuestions, index),
    }));
  }

  togglePublicDirectory() {
    this.communityModel.update((m) => ({
      ...m,
      isPublicDirectory: !m.isPublicDirectory,
    }));
  }

  setPublicationStatus(status: CommunityPublicationStatus) {
    if (status === 'published' && !this.canSetPublishedStatus()) return;
    this.communityModel.update((m) => ({
      ...m,
      status,
    }));
  }

  needsOptions(type: string | undefined): boolean {
    return needsVettingOptions(type);
  }

  onQuestionTypeChange(index: number, value: string | string[]): void {
    if (typeof value !== 'string') return;
    this.communityModel.update((model) => ({
      ...model,
      vettingQuestions: model.vettingQuestions.map((question, questionIndex) =>
        questionIndex === index ? {...question, type: value} : question,
      ),
    }));
  }

  onQuestionFieldChange(
    index: number,
    field: 'question' | 'optionsString',
    event: Event,
  ): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.communityModel.update((model) => ({
      ...model,
      vettingQuestions: model.vettingQuestions.map((question, questionIndex) =>
        questionIndex === index ? {...question, [field]: value} : question,
      ),
    }));
  }

  onQuestionRequiredChange(index: number, event: Event): void {
    const checked = readInputChecked(event.target);
    if (checked === null) return;
    this.communityModel.update((model) => ({
      ...model,
      vettingQuestions: model.vettingQuestions.map((question, questionIndex) =>
        questionIndex === index ? {...question, required: checked} : question,
      ),
    }));
  }

  async onSubmit() {
    this.submitted.set(true);
    if (this.f().invalid()) return;

    const publishGuardMessage = this.getPublishGuardMessage();
    if (publishGuardMessage) {
      toast.error(publishGuardMessage);
      return;
    }

    const formValue = this.communityModel();
    this.isSaving.set(true);

    try {
      const vettingQuestions = normalizeVettingQuestionsForSave(
        formValue.vettingQuestions ?? [],
      );

      const trimmedName = formValue.name.trim();
      if (!trimmedName) return;

      const payload = {
        name: trimmedName,
        slug: this.displaySlug(),
        email: formValue.email || undefined,
        contactInfo: formValue.contactInfo || undefined,
        description: formValue.description || undefined,
        status: formValue.status,
        isPublicDirectory: formValue.isPublicDirectory,
        vettingQuestions,
      };

      if (this.isEditMode()) {
        await this.communitiesService.update({
          id: this.communityId()!,
          ...payload,
        });
      } else {
        await this.communitiesService.create(payload);
      }

      void this.router.navigate(['/admin/communities']);
    } catch (error) {
      logger.error('Failed to save community', error);
      const message =
        error instanceof Error ? error.message : 'Failed to save community';
      toast.error(message);
    } finally {
      this.isSaving.set(false);
    }
  }

  private getPublishGuardMessage(): string | null {
    if (this.communityModel().status !== 'published') return null;
    if (!this.hasVettingQuestions()) {
      return 'Add at least one vetting question before publishing.';
    }
    if (!this.canPublishCommunity()) {
      return 'Stripe Connect onboarding or platform payouts are required before publishing.';
    }
    return null;
  }

  /** Toggle the isPlatformOrganizer flag for this community. Root admin only. */
  async togglePlatformOrganizer(): Promise<void> {
    if (this.isPlatformOrganizerSaving()) return; // Synchronous guard — zoneless [disabled] doesn't prevent double-click race
    const organizerId = this.communityId();
    if (!organizerId) return;

    const newValue = !this.isPlatformOrganizer();
    this.isPlatformOrganizerSaving.set(true);
    this.platformOrganizerError.set(null);

    try {
      await this.convex.mutation(api.communities.profile.setPlatformOrganizer, {
        organizerId,
        isPlatformOrganizer: newValue,
      });
      this.isPlatformOrganizer.set(newValue);
      this.organizerPaymentReady.set(
        newValue || this.hasStripeChargeReadiness(),
      );
    } catch (error) {
      logger.error('Failed to update platform organizer status', error);
      this.platformOrganizerError.set(
        'Failed to update platform organizer status. Please try again.',
      );
    } finally {
      this.isPlatformOrganizerSaving.set(false);
    }
  }

  private hasStripeChargeReadiness(): boolean {
    const onboardingStatus = this.stripeOnboardingStatus();
    return (
      Boolean(this.stripeConnectedAccountId()) &&
      this.stripeChargesEnabled() === true &&
      (onboardingStatus === 'complete' || onboardingStatus === 'restricted')
    );
  }

  /**
   * Create a Stripe connected account for this community.
   */
  async connectWithStripe(): Promise<void> {
    const organizerId = this.communityId();
    if (!organizerId) return;

    this.isStripeActionLoading.set(true);
    this.stripeError.set(null);

    try {
      const {stripeConnectedAccountId} = await this.convex.action(
        api.stripe.actions.createConnectedAccount,
        {organizerId},
      );
      this.stripeConnectedAccountId.set(stripeConnectedAccountId);
      await this.refreshStripeStatus();
    } catch (error) {
      logger.error('Failed to connect Stripe account', error);
      this.stripeError.set(
        'Failed to create Stripe account. Please try again.',
      );
    } finally {
      this.isStripeActionLoading.set(false);
    }
  }

  /** Components the embedded wrapper should mount for this account. */
  readonly stripeEmbeddedComponents = computed<
    readonly StripeConnectComponentKind[]
  >(() => {
    if (!this.stripeConnectedAccountId()) return [];
    if (this.organizerPaymentReady()) {
      return [
        'notification-banner',
        'account-management',
        'payments',
        'balances',
      ];
    }
    return ['account-onboarding'];
  });

  readonly stripeEmbedOrganizerId = computed<Id<'organizers'> | null>(() =>
    this.stripeConnectedAccountId() ? this.communityId() : null,
  );

  onEmbeddedExit(): void {
    void this.refreshStripeStatus();
  }

  onEmbeddedLoadError(message: string): void {
    this.stripeError.set(message);
  }

  private async refreshStripeStatus(): Promise<void> {
    const organizerId = this.communityId();
    if (!organizerId) return;

    this.isCheckingStripeStatus.set(true);
    this.stripeError.set(null);

    try {
      const status = await this.convex.action(
        api.stripe.actions.checkAccountStatus,
        {
          organizerId,
        },
      );
      this.stripeChargesEnabled.set(status.chargesEnabled);
      this.stripePayoutsEnabled.set(status.payoutsEnabled);
      this.stripeOnboardingStatus.set(status.onboardingStatus);
      this.organizerPaymentReady.set(status.chargeReady);
    } catch (error) {
      logger.error('Failed to check Stripe account status', error);
      this.stripeError.set('Failed to verify Stripe account status.');
    } finally {
      this.isCheckingStripeStatus.set(false);
    }
  }
}
