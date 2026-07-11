import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {type FunctionReturnType} from 'convex/server';
import {toSignal} from '@angular/core/rxjs-interop';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {toast} from 'ngx-sonner';
import {
  form,
  FormField,
  required,
  email as emailValidator,
  maxLength,
  type MaybeFieldTree,
} from '@angular/forms/signals';
import {api} from '@convex/_generated/api';
import type {Doc, Id} from '@convex/_generated/dataModel';
import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';
import {
  StripeConnectEmbedComponent,
  type StripeConnectComponentKind,
} from '@/features/admin/components/stripe-connect/stripe-connect-embed.component';
import {CommunityContextService} from '@/features/admin/services/community-context.service';
import {injectConvex, injectQueries, skipToken} from 'convex-angular';
import {ActivatedRoute, Router} from '@angular/router';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardSelectComponent} from '@ui/components/primitives/select/select.component';
import {ZardSelectItemComponent} from '@ui/components/primitives/select/select-item.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {ZardTooltipDirective} from '@ui/components/primitives/tooltip/tooltip';
import {logger} from '@/utils/logger';
import {
  ACCEPTED_IMAGE_FILE_INPUT,
  getAcceptedImageFormatsMessage,
  getUnsupportedImageTypeMessage,
  isAcceptedImageMimeType,
} from '@/features/admin/utils/image-upload-policy';
import {readInputChecked, readInputValue} from '@ui/utils/dom-event';
import {extractErrorMessage} from '@/core/utils/error-message.utils';
import {
  isSignalFormFieldInvalid,
  signalFormFieldHasError,
  notBlank,
} from '@/utils/signal-form';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {
  addVettingQuestion,
  buildDigestHourOptions,
  type CommunityProfileFormValue,
  DebounceTimer,
  isProfileDirty,
  moveVettingQuestion,
  needsVettingOptions,
  normalizeVettingQuestionsForSave,
  onVettingQuestionFieldChange,
  onVettingQuestionRequiredChange,
  onVettingQuestionTypeChange,
  removeVettingQuestion,
  ScannerSearchState,
  type VettingQuestionFormValue,
} from './community-admin-settings.helpers';
import {
  grantCommunityAdmin,
  grantCommunityScanner,
  grantCommunityScannerById,
  revokeCommunityAdmin,
  revokeCommunityScanner,
  saveCommunityAdminNotificationPreference,
  saveCommunityProfile,
} from './community-admin-settings.actions';

function getOrganizerStatus(
  status: CommunityPublicationStatus | undefined,
  vettingQuestions: {id: string}[] | undefined,
): CommunityPublicationStatus {
  if (status) return status;
  return vettingQuestions && vettingQuestions.length > 0
    ? 'published'
    : 'draft';
}

type StripeOnboardingStatus = NonNullable<
  Doc<'organizers'>['stripeOnboardingStatus']
>;

type ScannerGrantCandidate = FunctionReturnType<
  typeof api.communities.scanners.searchGrantCandidates
>[number];

const SCANNER_SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-community-admin-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    ZardButtonComponent,
    ZardIconComponent,
    ZardSelectComponent,
    ZardSelectItemComponent,
    ZardInputDirective,
    ZardTooltipDirective,
    ZardSkeletonComponent,
    StripeConnectEmbedComponent,
  ],
  templateUrl: './community-admin-settings.component.html',
  host: {
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class CommunityAdminSettingsComponent {
  protected readonly acceptedImageFileInput = ACCEPTED_IMAGE_FILE_INPUT;
  protected readonly acceptedImageFormatsMessage =
    getAcceptedImageFormatsMessage();
  protected readonly MAX_COMMUNITY_NAME_LENGTH = 200;
  protected readonly MAX_COMMUNITY_DESCRIPTION_LENGTH = 2000;

  private convex = injectConvex();
  private dialog = inject(BraDialogService);
  private communityCtx = inject(CommunityContextService);
  private destroyRef = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });
  private readonly stripeOnboardingHandled = signal(false);
  private browser = inject(BrowserPlatformService);
  readonly profileModel = signal<CommunityProfileFormValue>({
    name: '',
    email: '',
    contactInfo: '',
    description: '',
    website: '',
    slug: '',
    status: 'draft',
    isPublicDirectory: false,
    codeOfConduct: '',
  });
  profileForm = form(this.profileModel, (f) => {
    required(f.name);
    notBlank(f.name);
    maxLength(f.name, 200);
    emailValidator(f.email);
    maxLength(f.description, 2000);
  });
  readonly vettingModel = signal<VettingQuestionFormValue[]>([]);
  readonly isSaving = signal(false);
  readonly isSavingVetting = signal(false);
  private readonly pristineProfile = signal<CommunityProfileFormValue>({
    name: '',
    email: '',
    contactInfo: '',
    description: '',
    website: '',
    slug: '',
    status: 'draft',
    isPublicDirectory: false,
    codeOfConduct: '',
  });
  readonly profileDirty = computed(() => {
    return isProfileDirty(
      this.profileModel(),
      this.pristineProfile(),
      this.logoFile(),
      this.isLogoRemoved(),
    );
  });
  readonly hasUnsavedStatusChange = computed(
    () => this.profileModel().status !== this.pristineProfile().status,
  );
  readonly vettingDirty = signal(false);
  /** Combined dirty state — used by the navigation guard */
  readonly isDirty = computed(() => this.profileDirty() || this.vettingDirty());

  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.isDirty()) {
      event.preventDefault();
    }
  }

  protected readonly nameCharCount = computed(
    () => this.profileModel().name.length,
  );
  protected readonly descriptionCharCount = computed(
    () => this.profileModel().description.length,
  );
  private initializedProfileCommunityId: string | null = null;
  private initializedCommunityId: string | null = null;
  private initializedStripeCommunityId: string | null = null;

  readonly logoFile = signal<File | null>(null);
  readonly logoFileName = signal('');
  readonly isLogoRemoved = signal(false);
  readonly existingLogoUrl = computed(() => this.organizer()?.logoUrl ?? null);
  private readonly logoBlobUrl = signal<string | null>(null);
  readonly logoPreviewUrl = computed(() => {
    const blobUrl = this.logoBlobUrl();
    if (blobUrl) return blobUrl;
    if (this.isLogoRemoved()) return null;
    return this.existingLogoUrl();
  });
  // Page skeleton gates on the organizer query only; per-key status maps
  // skipToken → 'skipped' → false (matching the old skipToken → isLoading:false)
  // and a still-loading organizer → 'pending' → true.
  readonly isLoading = computed(
    () => this.queries.statuses().organizer === 'pending',
  );
  readonly organizer = computed(() => this.queries.results().organizer ?? null);
  readonly adminList = computed(() => this.queries.results().admins ?? []);
  readonly scannerList = computed(() => this.queries.results().scanners ?? []);
  readonly isLastAdmin = computed(() => this.adminList().length <= 1);

  readonly newAdminEmail = signal('');
  readonly isGrantingAdmin = signal(false);
  readonly isGrantingScanner = signal(false);

  /** Immediate + debounced search state, resolved before the query below
   * closes over it — breaks a circular type-inference cycle between the
   * query (needs the debounced term) and `scanner` (needs the query data). */
  private readonly scannerDebounce = new DebounceTimer(
    SCANNER_SEARCH_DEBOUNCE_MS,
  );
  readonly scannerSearchInputValue = signal('');
  private readonly debouncedScannerSearchTerm = signal('');

  // One consolidated subscription record for every organizer-scoped query.
  // Each key mirrors its original skipToken gate: it returns {query, args}
  // only when the organizer id (and, for scannerSearch, the debounced term)
  // is present, else skipToken. injectQueries preserves each key's prior
  // results() entry across an args change and exposes a per-key status()
  // ('pending' on subscribe, 'success' on settle, 'skipped' for skipToken).
  private readonly queries = injectQueries(() => {
    const id = this.communityCtx.selectedCommunityId();
    const searchTerm = this.debouncedScannerSearchTerm();
    return {
      organizer: id
        ? {query: api.communities.profile.getAdmin, args: {id}}
        : skipToken,
      admins: id
        ? {
            query: api.communities.admins.listByCommunity,
            args: {organizerId: id},
          }
        : skipToken,
      scanners: id
        ? {
            query: api.communities.scanners.listByCommunity,
            args: {organizerId: id},
          }
        : skipToken,
      scannerSearch:
        id && searchTerm
          ? {
              query: api.communities.scanners.searchGrantCandidates,
              args: {organizerId: id, searchTerm},
            }
          : skipToken,
      notificationPref: id
        ? {
            query:
              api.communities.management.notification_preferences
                .getMyNotificationPreference,
            args: {organizerId: id},
          }
        : skipToken,
    };
  });

  /**
   * The (term, organizer) pair that produced the current `scannerSearch`
   * results. Stamped from the live subscription args when data emits — Convex
   * only pushes data for the active subscription args, so at emit time the
   * untracked debounced term / selected organizer ARE the args that produced
   * that payload. `injectQueries` preserves each key's prior `results()` entry
   * across an args change (it resets a key to undefined only when the key is
   * absent), so this stamp is what lets us tell current data from
   * stale/in-flight data.
   */
  private readonly loadedScannerSearchTerm = signal<string | null>(null);
  private readonly loadedScannerOrganizerId = signal<Id<'organizers'> | null>(
    null,
  );

  /** True only when the query data matches the visible term AND selected org. */
  private readonly scannerResultsAreCurrent = computed(() => {
    const term = this.debouncedScannerSearchTerm().trim();
    const organizerId = this.communityCtx.selectedCommunityId();
    // Belt-and-suspenders gate; each conjunct closes a distinct stale window:
    //   - term non-empty: an empty/skip-token query is never "current".
    //     skipToken yields status 'skipped' (never 'success'), so the skip
    //     case is excluded by the status check itself, but keep this to close
    //     the keystroke → debounce gap alongside the next conjunct.
    //   - term === visible input: closes the keystroke → debounce gap
    //     (immediate input changed but the debounced query hasn't fired).
    //   - statuses().scannerSearch === 'success': injectQueries sets the key's
    //     status to 'pending' synchronously when args change and to 'success'
    //     only when the NEW args' data lands (convex-angular fesm2022
    //     injectQueries effect: 'pending' at subscribe time, 'success' in
    //     `settle`), so requiring '=== success' deterministically means
    //     results().scannerSearch is for the current args, not an in-flight
    //     refetch that still holds the previous payload. Never use the aggregate
    //     `!queries.isLoading()`: it is true whenever ANY of the 5 keys is
    //     pending, which would spuriously gate scanner results when an
    //     unrelated query reloads.
    //   - loadedTerm/loadedOrganizerId stamp: independent confirmation that
    //     the delivered data was produced by exactly this term + organizer.
    return (
      term.length > 0 &&
      term === this.scannerSearchInputValue().trim() &&
      this.queries.statuses().scannerSearch === 'success' &&
      this.loadedScannerSearchTerm() === term &&
      this.loadedScannerOrganizerId() === organizerId
    );
  });

  /** Owns all pure UI state for the door staff search combobox. */
  readonly scanner = new ScannerSearchState<ScannerGrantCandidate, Id<'users'>>(
    {
      searchInput: this.scannerSearchInputValue,
      debouncedTerm: this.debouncedScannerSearchTerm,
      debounce: this.scannerDebounce,
      results: computed(() => this.queries.results().scannerSearch ?? []),
      resultsAreCurrent: this.scannerResultsAreCurrent,
      resultUserId: (candidate) => candidate.userId,
      adminUserIds: computed(
        () => new Set(this.adminList().map((admin) => admin.userId)),
      ),
      scannerUserIds: computed(
        () => new Set(this.scannerList().map((scanner) => scanner.userId)),
      ),
    },
  );

  protected readonly notifMode = signal<'off' | 'all' | 'digest'>('off');
  protected readonly notifDigestHour = signal<number>(9);
  protected readonly notifSaving = signal(false);

  protected readonly digestHourOptions = computed(() => {
    return buildDigestHourOptions();
  });

  // Stripe Connect state (per selected community)
  readonly stripeConnectedAccountId = signal<string | null>(null);
  readonly stripeOnboardingStatus = signal<StripeOnboardingStatus | null>(null);
  readonly stripeChargesEnabled = signal<boolean | null>(null);
  readonly stripePayoutsEnabled = signal<boolean | null>(null);
  readonly stripeStatus = signal<{
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    userRequirementsClear: boolean;
  } | null>(null);
  readonly organizerPaymentReady = computed(
    () => this.organizer()?.organizerPaymentReady ?? false,
  );
  readonly isStripeActionLoading = signal(false);
  readonly isCheckingStripeStatus = signal(false);
  readonly stripeError = signal<string | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => this.revokeLogoBlobUrl());
    this.destroyRef.onDestroy(() => this.scannerDebounce.cancel());

    // Stamp the (term, organizer) that produced the current scanner-search
    // data. Convex pushes data only for the active subscription args, so when
    // the results entry emits the untracked debounced term / selected organizer are
    // exactly the args that produced it. `injectQueries` keeps each key's prior
    // `results()` entry during a refetch, so without this stamp a stale row
    // could be rendered or granted for a term the user has already moved past.
    effect(() => {
      const data = this.queries.results().scannerSearch;
      if (data === undefined) return; // no payload yet
      this.loadedScannerSearchTerm.set(
        untracked(this.debouncedScannerSearchTerm).trim(),
      );
      this.loadedScannerOrganizerId.set(
        untracked(() => this.communityCtx.selectedCommunityId()),
      );
    });

    effect(() => {
      const org = this.organizer();
      if (!org) return;
      if (this.initializedProfileCommunityId === org._id) return;
      this.initializedProfileCommunityId = org._id;
      const values = {
        name: org.name ?? '',
        email: org.email ?? '',
        contactInfo: org.contactInfo ?? '',
        description: org.description ?? '',
        website: org.website ?? '',
        slug: org.slug ?? '',
        status: getOrganizerStatus(org.status, org.vettingQuestions),
        isPublicDirectory: org.isPublicDirectory ?? false,
        codeOfConduct: org.codeOfConduct ?? '',
      };
      this.profileModel.set(values);
      this.pristineProfile.set(values);
    });

    effect(() => {
      const org = this.organizer();
      if (!org) return;

      // Reset state when switching communities; keep in sync otherwise.
      if (this.initializedStripeCommunityId !== org._id) {
        this.initializedStripeCommunityId = org._id;
        this.stripeStatus.set(null);
        this.stripeOnboardingStatus.set(null);
        this.stripeChargesEnabled.set(null);
        this.stripePayoutsEnabled.set(null);
        this.stripeError.set(null);
      }

      this.stripeConnectedAccountId.set(org.stripeConnectedAccountId ?? null);
      this.stripeOnboardingStatus.set(org.stripeOnboardingStatus ?? null);
      this.stripeChargesEnabled.set(org.stripeChargesEnabled ?? null);
      this.stripePayoutsEnabled.set(org.stripePayoutsEnabled ?? null);
    });

    effect(() => {
      const org = this.organizer();
      if (!org) return;
      if (this.initializedCommunityId === org._id) return;
      this.initializedCommunityId = org._id;
      this.vettingModel.set(
        (org.vettingQuestions ?? []).map(
          (q: {
            id: string;
            question: string;
            type: string;
            required: boolean;
            options?: string[];
          }) => ({
            id: q.id,
            question: q.question,
            type: q.type,
            required: q.required,
            options: q.options ?? [],
            optionsString: q.options?.join(', ') ?? '',
          }),
        ),
      );
    });

    effect(() => {
      const pref = this.queries.results().notificationPref;
      if (pref === undefined) return; // still loading
      if (pref === null) {
        this.notifMode.set('off');
        this.notifDigestHour.set(9);
      } else {
        this.notifMode.set(pref.mode);
        this.notifDigestHour.set(pref.digestHour);
      }
    });

    effect(() => {
      if (this.stripeOnboardingHandled()) {
        return;
      }

      const queryParamMap = this.queryParamMap();
      // V2 account_links.create return URLs use `stripeOnboardingReturn=1`
      // (completed) or `stripeOnboardingRefresh=1` (link expired). The
      // legacy V1 param `stripe_onboarding=complete|refresh` is no longer supported.
      const v2Return = queryParamMap.get('stripeOnboardingReturn');
      const v2Refresh = queryParamMap.get('stripeOnboardingRefresh');
      // Backend return/refresh URLs carry `?community=<orgId>` — consistent
      // with how the rest of community-admin uses this param.
      const communityParam = queryParamMap.get('community');

      const isComplete = v2Return !== null;
      const isRefresh = v2Refresh !== null;

      if (isComplete) {
        this.stripeOnboardingHandled.set(true);
        void this.refreshStripeStatus({
          organizerId: communityParam
            ? (communityParam as Id<'organizers'>)
            : (this.communityCtx.selectedCommunityId() ?? undefined),
          cleanupQueryParams: true,
        });
      } else if (isRefresh) {
        this.stripeOnboardingHandled.set(true);
        this.stripeError.set(
          'Stripe onboarding was not completed. Please resume onboarding.',
        );
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {
            stripeOnboardingReturn: null,
            stripeOnboardingRefresh: null,
            community: null,
          },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
  }

  private revokeLogoBlobUrl(): void {
    const prev = this.logoBlobUrl();
    if (prev) this.browser.revokeObjectUrl(prev);
    this.logoBlobUrl.set(null);
  }

  onLogoFileChange(event: Event): void {
    const target = event.target;
    if (!target || typeof target !== 'object' || !('files' in target)) return;
    const inputTarget = target as HTMLInputElement;
    const fileList = inputTarget.files;
    const file = fileList ? fileList[0] : null;
    if (!(file instanceof File)) return;
    if (!isAcceptedImageMimeType(file.type)) {
      this.revokeLogoBlobUrl();
      toast.error(getUnsupportedImageTypeMessage());
      this.logoFile.set(null);
      this.logoFileName.set('');
      inputTarget.value = '';
      return;
    }
    this.revokeLogoBlobUrl();
    this.logoBlobUrl.set(this.browser.createObjectUrl(file));
    this.logoFile.set(file);
    this.logoFileName.set(file.name);
    this.isLogoRemoved.set(false);
  }

  removeLogo(): void {
    this.revokeLogoBlobUrl();
    this.logoFile.set(null);
    this.logoFileName.set('');
    this.isLogoRemoved.set(true);
  }

  protected isFieldInvalid<T>(field: MaybeFieldTree<T>): boolean {
    return isSignalFormFieldInvalid(field, false, {includeDirty: true});
  }

  protected hasError<T>(field: MaybeFieldTree<T>, errorKind: string): boolean {
    return signalFormFieldHasError(field, errorKind);
  }

  async saveProfile(): Promise<void> {
    if (this.profileForm().invalid()) return;
    const communityId = this.communityCtx.selectedCommunityId();
    if (!communityId) return;
    if (
      this.profileModel().status === 'published' &&
      this.vettingModel().length === 0
    ) {
      toast.error('Add at least one vetting question before publishing.');
      return;
    }

    this.isSaving.set(true);
    const submittedProfile = this.profileModel();
    try {
      await saveCommunityProfile(
        this.convex,
        communityId,
        submittedProfile,
        this.logoFile(),
        this.isLogoRemoved(),
      );

      this.pristineProfile.set(submittedProfile);
      this.revokeLogoBlobUrl();
      this.logoFile.set(null);
      this.logoFileName.set('');
      this.isLogoRemoved.set(false);
      toast.success('Settings saved');
    } catch (e) {
      logger.error('Failed to save settings', e);
      const message =
        e instanceof Error ? e.message : 'Failed to save settings';
      toast.error(message);
    } finally {
      this.isSaving.set(false);
    }
  }

  async saveVettingQuestions(): Promise<void> {
    const communityId = this.communityCtx.selectedCommunityId();
    if (!communityId) return;
    if (this.hasUnsavedStatusChange()) {
      toast.error('Save profile status changes before saving questions.');
      return;
    }
    if (
      this.profileModel().status === 'published' &&
      this.vettingModel().length === 0
    ) {
      toast.error(
        'Published communities must have at least one vetting question.',
      );
      return;
    }

    this.isSavingVetting.set(true);
    try {
      const vettingQuestions = normalizeVettingQuestionsForSave(
        this.vettingModel(),
      );

      await this.convex.mutation(api.communities.profile.update, {
        id: communityId,
        vettingQuestions,
      });

      this.vettingDirty.set(false);
      toast.success('Questions saved');
    } catch (e) {
      logger.error('Failed to save vetting questions', e);
      const message =
        e instanceof Error ? e.message : 'Failed to save questions';
      toast.error(message);
    } finally {
      this.isSavingVetting.set(false);
    }
  }

  addQuestion(): void {
    this.vettingModel.update((questions) => addVettingQuestion(questions));
    this.vettingDirty.set(true);
  }

  removeQuestion(index: number): void {
    this.vettingModel.update((questions) =>
      removeVettingQuestion(questions, index),
    );
    this.vettingDirty.set(true);
  }

  moveQuestion(index: number, direction: -1 | 1): void {
    this.vettingModel.update((questions) =>
      moveVettingQuestion(questions, index, direction),
    );
    this.vettingDirty.set(true);
  }

  needsOptions(type: string | undefined): boolean {
    return needsVettingOptions(type);
  }

  onQuestionTypeChange(index: number, value: string | string[]): void {
    if (typeof value !== 'string') return;
    this.vettingModel.update((questions) =>
      onVettingQuestionTypeChange(questions, index, value),
    );
    this.vettingDirty.set(true);
  }

  readonly hasVettingQuestions = computed(() => this.vettingModel().length > 0);
  readonly canSetPublishedStatus = computed(() => this.hasVettingQuestions());
  readonly hasBlockedPublishedState = computed(
    () =>
      this.profileModel().status === 'published' &&
      !this.canSetPublishedStatus(),
  );

  setProfileStatus(status: CommunityPublicationStatus): void {
    if (status === 'published' && !this.canSetPublishedStatus()) return;
    this.profileModel.update((model) => ({...model, status}));
  }

  onQuestionFieldChange(
    index: number,
    field: 'question' | 'optionsString',
    event: Event,
  ): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.vettingModel.update((questions) =>
      onVettingQuestionFieldChange(questions, index, field, value),
    );
    this.vettingDirty.set(true);
  }

  onRequiredChange(index: number, event: Event): void {
    const checked = readInputChecked(event.target);
    if (checked === null) return;
    this.vettingModel.update((questions) =>
      onVettingQuestionRequiredChange(questions, index, checked),
    );
    this.vettingDirty.set(true);
  }

  async grantAdmin(): Promise<void> {
    const emailInput = this.newAdminEmail().trim();
    const organizerId = this.communityCtx.selectedCommunityId();
    if (!emailInput || !organizerId) return;

    this.isGrantingAdmin.set(true);
    try {
      await grantCommunityAdmin(this.convex, emailInput, organizerId);
      this.newAdminEmail.set('');
      toast.success('Admin granted');
    } catch (e) {
      logger.error('Failed to grant admin', e);
      const message = extractErrorMessage(e) || 'Failed to grant admin';
      toast.error(message);
    } finally {
      this.isGrantingAdmin.set(false);
    }
  }

  confirmRemoveAdmin(userId: Id<'users'>): void {
    this.dialog.create({
      zTitle: 'remove admin',
      zDescription:
        'Are you sure you want to remove this admin? They will lose access to manage this community.',
      zOkText: 'yes, remove',
      zOkDestructive: true,
      zCancelText: 'cancel',
      zOnOk: () => {
        void this.revokeAdmin(userId);
      },
    });
  }

  private async revokeAdmin(userId: Id<'users'>): Promise<void> {
    const organizerId = this.communityCtx.selectedCommunityId();
    if (!organizerId) return;

    try {
      await revokeCommunityAdmin(this.convex, userId, organizerId);
      toast.success('Admin removed');
    } catch (e) {
      logger.error('Failed to revoke admin', e);
      const message = e instanceof Error ? e.message : 'Failed to revoke admin';
      toast.error(message);
    }
  }

  onScannerSearchInput(event: Event): void {
    const value = readInputValue(event.target);
    if (value === null) return;
    this.scanner.onInput(value);
  }

  private async runGrantScanner(grant: () => Promise<void>): Promise<void> {
    this.isGrantingScanner.set(true);
    try {
      await grant();
      this.scanner.clear();
      toast.success('Scanner granted');
    } catch (e) {
      logger.error('Failed to grant scanner', e);
      toast.error(extractErrorMessage(e) || 'Failed to grant scanner');
    } finally {
      this.isGrantingScanner.set(false);
    }
  }

  async grantScannerByRow(candidate: ScannerGrantCandidate): Promise<void> {
    const organizerId = this.communityCtx.selectedCommunityId();
    // Hard guard, path-independent: never grant a stale/in-flight row.
    // `canGrantResult` requires results to be current (matching the visible
    // term + selected organizer) and the row not already an admin/scanner —
    // defends against clicking a row rendered from the previous query.
    if (!organizerId || !this.scanner.canGrantResult(candidate)) return;
    await this.runGrantScanner(() =>
      grantCommunityScannerById(this.convex, candidate.userId, organizerId),
    );
  }

  async grantScannerByExactEmail(): Promise<void> {
    const emailInput = this.scanner.trimmedSearch();
    const organizerId = this.communityCtx.selectedCommunityId();
    if (!emailInput || !organizerId) return;
    await this.runGrantScanner(() =>
      grantCommunityScanner(this.convex, emailInput, organizerId),
    );
  }

  onScannerSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      if (this.scanner.onArrowDown()) event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      if (this.scanner.onArrowUp()) event.preventDefault();
    } else if (event.key === 'Enter') {
      const target = this.scanner.onEnter();
      if (target === null) return;
      event.preventDefault();
      if (target === 'email-fallback') {
        void this.grantScannerByExactEmail();
      } else {
        void this.grantScannerByRow(target);
      }
    } else if (event.key === 'Escape' && this.scanner.search()) {
      event.preventDefault();
      this.scanner.clear();
    }
  }

  confirmRemoveScanner(userId: Id<'users'>): void {
    this.dialog.create({
      zTitle: 'remove scanner',
      zDescription:
        'Are you sure you want to remove this scanner? They will lose the ability to check in guests.',
      zOkText: 'yes, remove',
      zOkDestructive: true,
      zCancelText: 'cancel',
      zOnOk: () => {
        void this.revokeScanner(userId);
      },
    });
  }

  private async revokeScanner(userId: Id<'users'>): Promise<void> {
    const organizerId = this.communityCtx.selectedCommunityId();
    if (!organizerId) return;

    try {
      await revokeCommunityScanner(this.convex, userId, organizerId);
      toast.success('Scanner removed');
    } catch (e) {
      logger.error('Failed to revoke scanner', e);
      const message =
        e instanceof Error ? e.message : 'Failed to revoke scanner';
      toast.error(message);
    }
  }

  protected onNotifModeChange(value: string | string[]): void {
    this.notifMode.set(value as 'off' | 'all' | 'digest');
  }

  protected onDigestHourChange(value: string | string[]): void {
    this.notifDigestHour.set(+(value as string));
  }

  async saveNotificationPreference(): Promise<void> {
    const organizerId = this.communityCtx.selectedCommunityId();
    if (!organizerId) return;

    this.notifSaving.set(true);
    try {
      await saveCommunityAdminNotificationPreference(
        this.convex,
        organizerId,
        this.notifMode(),
        this.notifDigestHour(),
      );
      toast.success('Notification preference saved');
    } catch (e) {
      logger.error('Failed to save notification preference', e);
      const message =
        e instanceof Error
          ? e.message
          : 'Failed to save notification preference';
      toast.error(message);
    } finally {
      this.notifSaving.set(false);
    }
  }

  /**
   * Start a Stripe Connect V2 account for the current community.
   *
   * V2 Connect with `losses_collector: 'stripe'` forces Stripe to own
   * requirement collection, so KYC runs on a Stripe-hosted page. This
   * action creates the connected account, then hands control off to
   * the hosted onboarding URL. When the user returns, embedded
   * management components take over.
   */
  async connectWithStripe(): Promise<void> {
    const organizerId = this.communityCtx.selectedCommunityId();
    if (!organizerId) return;

    this.isStripeActionLoading.set(true);
    this.stripeError.set(null);

    try {
      const {stripeConnectedAccountId} = await this.convex.action(
        api.stripe.actions.createConnectedAccount,
        {organizerId},
      );
      this.stripeConnectedAccountId.set(stripeConnectedAccountId);
      // Stay on the page. Check actual KYC status from Stripe so the UI
      // reflects charges_enabled / payouts_enabled, not just account creation.
      // The embedded account-onboarding component mounts below; if it cannot
      // collect KYC inline (V2 accounts with losses_collector:'stripe'), the
      // "Continue Setup on Stripe" CTA (openStripeOnboarding) is the path.
      await this.refreshStripeStatus();
    } catch (e) {
      logger.error('Failed to connect Stripe account', e);
      this.stripeError.set(
        'Failed to create Stripe account. Please try again.',
      );
    } finally {
      this.isStripeActionLoading.set(false);
    }
  }

  /**
   * Components to mount in the embedded Connect container.
   *
   * Incomplete accounts (KYC not yet confirmed by Stripe) mount
   * `account-onboarding` so the embedded iframe provides context. V2
   * accounts with `losses_collector:'stripe'` cannot collect KYC inline
   * (Stripe forces `requirements_collector:'stripe'`), so the component
   * will emit `loadError`, surfacing the "Continue Setup on Stripe" CTA
   * as the hosted fallback.
   *
   * Fully-onboarded accounts get the self-serve management cluster.
   */
  readonly stripeEmbeddedComponents = computed<
    readonly StripeConnectComponentKind[]
  >(() => {
    if (!this.stripeConnectedAccountId()) return [];
    if (!this.organizerPaymentReady()) return ['account-onboarding'];
    return [
      'notification-banner',
      'account-management',
      'payments',
      'balances',
    ];
  });

  /**
   * The embed component requires a non-null organizer id. Returns the
   * community id whenever a Stripe account exists — both complete and
   * incomplete accounts render an embedded component (onboarding for
   * incomplete, management cluster for complete).
   */
  readonly stripeEmbedOrganizerId = computed<Id<'organizers'> | null>(() => {
    if (!this.stripeConnectedAccountId()) return null;
    return this.communityCtx.selectedCommunityId();
  });

  /**
   * Mint a fresh Stripe-hosted onboarding URL and navigate the user
   * there. Used by the "Continue Setup on Stripe" CTA for accounts
   * that are connected but not yet fully onboarded.
   */
  async openStripeOnboarding(): Promise<void> {
    const organizerId = this.communityCtx.selectedCommunityId();
    if (!organizerId) return;

    this.isStripeActionLoading.set(true);
    this.stripeError.set(null);

    try {
      const {url} = await this.convex.action(
        api.stripe.actions.createAccountOnboardingLink,
        {
          organizerId,
          returnOrigin: this.browser.origin(),
        },
      );
      // Full-page redirect so the Stripe-hosted flow owns the tab; it
      // returns the user to our settings page when done.
      this.browser.assign(url);
    } catch (e) {
      logger.error('Failed to open Stripe onboarding', e);
      this.stripeError.set(
        'Failed to open Stripe onboarding. Please try again.',
      );
    } finally {
      this.isStripeActionLoading.set(false);
    }
  }

  onEmbeddedExit(): void {
    // User completed an account-management flow — re-pull status so
    // the UI reflects what Stripe confirmed.
    void this.refreshStripeStatus();
  }

  onEmbeddedLoadError(message: string): void {
    this.stripeError.set(message);
  }

  async refreshStripeStatus(opts?: {
    organizerId?: Id<'organizers'>;
    cleanupQueryParams?: boolean;
  }): Promise<void> {
    const organizerId =
      opts?.organizerId ?? this.communityCtx.selectedCommunityId();
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
      this.stripeStatus.set({
        chargesEnabled: status.chargesEnabled,
        payoutsEnabled: status.payoutsEnabled,
        userRequirementsClear: status.userRequirementsClear,
      });

      if (opts?.cleanupQueryParams) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {
            stripeOnboardingReturn: null,
            stripeOnboardingRefresh: null,
            community: null,
          },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    } catch (e) {
      logger.error('Failed to check Stripe account status', e);
      this.stripeError.set('Failed to verify Stripe account status.');
    } finally {
      this.isCheckingStripeStatus.set(false);
    }
  }
}
