import {
  Component,
  inject,
  signal,
  ChangeDetectionStrategy,
  effect,
  Injector,
  runInInjectionContext,
  input,
  untracked,
  resource,
  computed,
  DestroyRef,
} from '@angular/core';
import {
  FormField,
  form,
  required,
  requiredError,
  minLength,
  maxLength,
  validate,
  type MaybeFieldTree,
} from '@angular/forms/signals';
import {AuthService} from '@/core/services/auth.service';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {
  CommunitiesService,
  type VettingQuestion as CommunityVettingQuestion,
} from '@/core/services/communities.service';
import {DashboardDataService} from '@/features/dashboard/services/dashboard-data.service';
import {Router, RouterLink} from '@angular/router';
import {toast} from 'ngx-sonner';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {type Id} from '@convex/_generated/dataModel';
import {api} from '@convex/_generated/api';
import {injectQuery, skipToken} from 'convex-angular';
import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';
import {ConvexError} from 'convex/values';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';
import {createSubmitGuard} from '@/utils/submit-guard';
import {readInputChecked} from '@ui/utils/dom-event';
import {
  castSignalFormField,
  isSignalFormFieldInvalid,
  signalFormFieldHasError,
} from '@/utils/signal-form';

interface DisplayQuestion {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
  minLength?: number;
}

interface QuestionsResourceResult {
  routeId: string | null;
  questions: DisplayQuestion[];
  organizerId: Id<'organizers'> | null;
  isApplicationUnavailable: boolean;
  unavailableMessage?: string;
  codeOfConduct?: string;
}

type VettingFieldValue = string | boolean | string[];

type VettingFormModel = {
  conduct: boolean;
} & Record<string, VettingFieldValue>;

function normalizeCodeOfConduct(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function sanitizeStoredVettingData(value: unknown): VettingFormModel | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const out: VettingFormModel = {
    conduct: Reflect.get(value, 'conduct') === true,
  };

  for (const [key, entry] of Object.entries(value)) {
    if (key === 'timestamp' || key === 'conduct') continue;
    if (
      typeof entry === 'string' ||
      typeof entry === 'boolean' ||
      isStringArray(entry)
    ) {
      out[key] = entry;
    }
  }

  return out;
}

function hasRestorableVettingValue(value: VettingFieldValue): boolean {
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'boolean') return value;
  return value.length > 0;
}

function hasRestorableVettingDraft(
  values: Record<string, VettingFieldValue>,
): boolean {
  return Object.values(values).some(hasRestorableVettingValue);
}

function deriveCommunityStatus(community: {
  status?: CommunityPublicationStatus;
  vettingQuestions?: {id: string}[];
}): CommunityPublicationStatus {
  if (community.status) return community.status;
  return community.vettingQuestions && community.vettingQuestions.length > 0
    ? 'published'
    : 'draft';
}

// Type for the form instance - use ReturnType to get the actual form type
type VettingFormInstance = ReturnType<typeof form<VettingFormModel>>;

/** Maximum character length for a single application answer — must match backend MAX_ANSWER_STRING_LENGTH */
const MAX_ANSWER_STRING_LENGTH = 10000;

@Component({
  selector: 'app-vetting',
  imports: [
    FormField,
    RouterLink,
    ZardButtonComponent,
    ZardInputDirective,
    ZardSkeletonComponent,
  ],
  templateUrl: './vetting.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VettingComponent {
  private auth = inject(AuthService);
  private appsService = inject(ApplicationsService);
  private communitiesService = inject(CommunitiesService);
  private dashboardData = inject(DashboardDataService);
  private router = inject(Router);
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private dialogService = inject(BraDialogService);

  readonly MAX_ANSWER_STRING_LENGTH = MAX_ANSWER_STRING_LENGTH;

  readonly id = input<string | undefined>();

  /** Submit guard to prevent double-click submissions */
  private submitGuard = createSubmitGuard();
  isSubmitting = this.submitGuard.isSubmitting;
  readonly errorMsg = signal('');
  /** Shows success state after submission before navigation */
  readonly submissionComplete = signal(false);

  /**
   * Pre-check for existing application for the specific community.
   * If the user already has a pending or approved application for THIS organizer,
   * we show a status message instead of the form.
   * Note: Uses the resolved organizerId (from questionsResource) so slug-based
   * routes work correctly — the raw route param may be a slug, not a Convex ID.
   */
  private existingApplicationQuery = injectQuery(
    api.communities.applications.getMyApplicationForOrganizer,
    () => {
      const organizerId = this.organizerIdFromResource();
      const user = this.auth.user();
      return organizerId && user ? {organizerId} : skipToken;
    },
  );

  /** The user's existing application, exposed for template access */
  readonly existingApplication = computed(() =>
    this.appsService.mapToApp(this.existingApplicationQuery.data() ?? null),
  );

  /**
   * Resource that loads questions AND captures the organizerId that was used.
   * This prevents race conditions where the route param changes after questions load
   * but before submission - we submit with the same organizerId whose questions were shown.
   */
  questionsResource = resource({
    params: () => ({id: this.id(), user: this.auth.user()}),
    loader: async ({params}): Promise<QuestionsResourceResult> => {
      if (!params.user) {
        return {
          routeId: params.id ?? null,
          questions: [],
          organizerId: null,
          isApplicationUnavailable: false,
        };
      }

      const id = params.id;
      if (id) {
        const community = await this.communitiesService.getBySlugOrId(id);
        if (!community) {
          return {
            routeId: id,
            questions: [],
            organizerId: null,
            isApplicationUnavailable: true,
            unavailableMessage: 'This community was not found.',
          };
        }

        const status = deriveCommunityStatus(community);
        const vettingQuestions = community.vettingQuestions ?? [];
        if (status !== 'published' || vettingQuestions.length === 0) {
          return {
            routeId: id,
            questions: [],
            organizerId: community._id,
            isApplicationUnavailable: true,
            unavailableMessage:
              "This community isn't accepting applications right now.",
          };
        }

        return {
          routeId: id,
          questions: vettingQuestions.map((q: CommunityVettingQuestion) => ({
            id: q.id,
            label: q.question,
            type: q.type,
            required: q.required,
            options: q.options,
            placeholder:
              q.type === 'text' || q.type === 'long_text'
                ? 'Enter your answer...'
                : undefined,
            minLength: undefined,
          })),
          organizerId: community._id,
          isApplicationUnavailable: false,
          codeOfConduct: community.codeOfConduct,
        };
      } else {
        // No organizer specified - cannot show vetting form
        return {
          routeId: null,
          questions: [],
          organizerId: null,
          isApplicationUnavailable: true,
          unavailableMessage: 'No community was selected for vetting.',
        };
      }
    },
  });

  readonly questions = computed(
    () => safeResourceValue(this.questionsResource)?.questions ?? [],
  );
  readonly applicationUnavailable = computed(
    () =>
      safeResourceValue(this.questionsResource)?.isApplicationUnavailable ===
      true,
  );
  readonly isRejected = computed(
    () => this.existingApplication()?.status === 'rejected',
  );
  readonly rejectionReason = computed(() => {
    const application = this.existingApplication();
    return application?.denyReason ?? application?.reason ?? null;
  });
  readonly unavailableMessage = computed(
    () =>
      safeResourceValue(this.questionsResource)?.unavailableMessage ??
      "This community isn't accepting applications right now.",
  );
  readonly codeOfConduct = computed(() =>
    normalizeCodeOfConduct(
      safeResourceValue(this.questionsResource)?.codeOfConduct,
    ),
  );
  readonly hasCodeOfConduct = computed(() => this.codeOfConduct() !== null);
  isLoading = this.questionsResource.isLoading;
  readonly isExistingApplicationGateLoading = computed(() => {
    if (!this.id()) {
      return false;
    }

    // Optimistic activation window: the route was admitted on a cached
    // credential but auth has not settled, so the user-keyed resources have
    // not started. Show the gate skeleton instead of an empty question form.
    if (!this.auth.authSettled()) {
      return true;
    }

    if (!this.auth.user()) {
      return false;
    }

    if (this.questionsResource.error() || this.applicationUnavailable()) {
      return false;
    }

    if (this.questionsResource.isLoading()) {
      return true;
    }

    const organizerId = this.organizerIdFromResource();
    if (!organizerId) {
      return false;
    }

    return this.existingApplicationQuery.isLoading();
  });
  readonly existingApplicationGateErrorMessage = computed(() => {
    if (!this.auth.user() || !this.id()) {
      return null;
    }

    if (this.questionsResource.error()) {
      return "We couldn't load this community's application status right now. Refresh and try again.";
    }

    if (this.applicationUnavailable() || this.questionsResource.isLoading()) {
      return null;
    }

    if (!this.organizerIdFromResource()) {
      return "We couldn't load this community's application status right now. Refresh and try again.";
    }

    return this.existingApplicationQuery.error()
      ? "We couldn't check your application status right now. Refresh and try again."
      : null;
  });

  showCodeOfConduct(): void {
    const content = this.codeOfConduct();
    if (!content) return;

    this.dialogService.create({
      zTitle: 'Code of Conduct',
      zContent: content,
      zOkText: 'Close',
      zCancelText: null,
      zWidth: 'min(600px, calc(100vw - 2rem))',
      zCustomClasses: 'max-h-[70vh] overflow-y-auto whitespace-pre-wrap',
    });
  }

  /**
   * The organizerId captured when questions were loaded - use this for submission,
   * NOT this.id() which could have changed after questions loaded.
   */
  readonly organizerIdFromResource = computed(
    () => safeResourceValue(this.questionsResource)?.organizerId ?? null,
  );

  // Create initial model with conduct checkbox
  readonly vettingModel = signal<VettingFormModel>({conduct: false});

  // Store form - will be created after questions load
  readonly vettingForm = signal<VettingFormInstance | null>(null);

  // Track if form was initialized (to avoid overwriting restored values)
  private readonly formInitialized = signal(false);

  private readonly activeStorageKey = signal<string | null>(null);
  private readonly activeDraftQuestions = signal<DisplayQuestion[]>([]);

  /**
   * Get the sessionStorage key for persisting form state.
   * Includes the route community ID or slug to prevent mixing data between different forms.
   */
  private getStorageKey(routeId: string | null = this.id() ?? null): string {
    const orgId = routeId ?? 'default';
    return `vetting-form-${orgId}`;
  }

  /**
   * Save current form values to sessionStorage for persistence across app switches.
   * Called by an effect whenever form values change.
   */
  private saveFormToStorage(storageKey = this.activeStorageKey()): void {
    const formInstance = this.vettingForm();
    if (!storageKey || !formInstance || !this.formInitialized()) return;

    try {
      const values = this.extractDraftFormValues();
      // Also save conduct checkbox
      const conductField = formInstance['conduct'];
      const conductValue =
        conductField && typeof conductField === 'function'
          ? conductField().value()
          : false;

      if (!hasRestorableVettingDraft({...values, conduct: conductValue})) {
        sessionStorage.removeItem(storageKey);
        return;
      }

      const dataToSave = {
        ...values,
        conduct: conductValue,
        timestamp: Date.now(),
      };

      sessionStorage.setItem(storageKey, JSON.stringify(dataToSave));
    } catch (e) {
      // sessionStorage might be unavailable in private mode on some browsers
      logger.debug('[Vetting] Failed to save form to sessionStorage:', e);
    }
  }

  /**
   * Restore form values from sessionStorage if available.
   * Returns the saved model or null if nothing saved.
   */
  private restoreFormFromStorage(storageKey: string): VettingFormModel | null {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (!saved) return null;

      const data: unknown = JSON.parse(saved);
      if (typeof data !== 'object' || data === null) {
        return null;
      }

      // Check if data is stale (older than 24 hours)
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      const timestamp: unknown = Reflect.get(data, 'timestamp');
      if (typeof timestamp === 'number' && Date.now() - timestamp > maxAge) {
        sessionStorage.removeItem(storageKey);
        return null;
      }

      logger.debug('[Vetting] Restoring form from sessionStorage');
      return sanitizeStoredVettingData(data);
    } catch (e) {
      logger.debug('[Vetting] Failed to restore form from sessionStorage:', e);
      return null;
    }
  }

  /**
   * Clear saved form data from sessionStorage.
   * Called on successful submission.
   */
  private clearFormStorage(): void {
    const storageKey = this.activeStorageKey();
    if (!storageKey) return;

    try {
      sessionStorage.removeItem(storageKey);
    } catch (e) {
      logger.debug('[Vetting] Failed to clear sessionStorage:', e);
    } finally {
      if (this.saveDebounceTimeout) {
        clearTimeout(this.saveDebounceTimeout);
        this.saveDebounceTimeout = null;
      }
      this.formInitialized.set(false);
      this.activeStorageKey.set(null);
      this.activeDraftQuestions.set([]);
    }
  }

  private flushPendingSave(storageKey = this.activeStorageKey()): void {
    if (this.saveDebounceTimeout) {
      clearTimeout(this.saveDebounceTimeout);
      this.saveDebounceTimeout = null;
    }
    this.saveFormToStorage(storageKey);
  }

  constructor() {
    // Effect to initialize form when questions load
    effect(() => {
      const error = this.questionsResource.error();
      if (error) {
        untracked(() => {
          logger.error('Failed to initialize vetting form', error);
          this.errorMsg.set('Failed to load vetting questions.');
          this.vettingForm.set(null);
          this.formInitialized.set(false);
        });
        return;
      }

      const routeId = this.id() ?? null;
      const storageKey = this.getStorageKey(routeId);
      const activeStorageKey = untracked(() => this.activeStorageKey());
      if (activeStorageKey && activeStorageKey !== storageKey) {
        untracked(() => {
          this.flushPendingSave(activeStorageKey);
          this.vettingForm.set(null);
          this.formInitialized.set(false);
          this.activeStorageKey.set(null);
          this.activeDraftQuestions.set([]);
        });
      }

      const result = safeResourceValue(this.questionsResource);
      if (result && result.routeId !== routeId) {
        return;
      }

      const qs = result?.questions;
      if (qs && qs.length > 0) {
        untracked(() => {
          // Try to restore saved form data first
          const savedData = this.restoreFormFromStorage(storageKey);

          const model: VettingFormModel = {
            conduct: savedData?.conduct ?? false,
          };

          // Add fields for each question with appropriate initial values
          qs.forEach((q) => {
            // Check if we have a saved value for this field
            const savedValue = savedData?.[q.id];

            if (q.type === 'checkbox') {
              model[q.id] = Array.isArray(savedValue) ? savedValue : [];
            } else if (q.type === 'boolean') {
              // Radio buttons store string values
              if (typeof savedValue === 'string') {
                model[q.id] = savedValue;
              } else if (typeof savedValue === 'boolean') {
                model[q.id] = savedValue ? 'true' : 'false';
              } else {
                model[q.id] = '';
              }
            } else {
              model[q.id] = typeof savedValue === 'string' ? savedValue : '';
            }
          });

          // Update model
          this.vettingModel.set(model);

          // Create form with validators within injection context
          const formInstance = runInInjectionContext(this.injector, () => {
            return this.createForm(
              this.vettingModel,
              qs,
              this.hasCodeOfConduct(),
            );
          });
          this.vettingForm.set(formInstance);
          this.activeStorageKey.set(storageKey);
          this.activeDraftQuestions.set(qs);

          // Mark as initialized after form is created
          this.formInitialized.set(true);

          if (savedData) {
            toast.info('Form restored', {
              description: 'Your previous answers have been restored.',
              duration: 3000,
            });
          }
        });
      } else {
        untracked(() => {
          this.vettingForm.set(null);
          this.formInitialized.set(false);
          this.activeStorageKey.set(null);
          this.activeDraftQuestions.set([]);
        });
      }
    });

    // Apply dark mode to document root so accessibility tools compute contrast
    // against the actual dark background, not the light-mode body background.
    // The vetting page always renders in dark mode regardless of user preference.
    if (typeof document !== 'undefined') {
      const htmlEl = document.documentElement;
      const hadDark = htmlEl.classList.contains('dark');
      const prevColorScheme = htmlEl.style.colorScheme;
      htmlEl.classList.add('dark');
      htmlEl.style.colorScheme = 'dark';
      this.destroyRef.onDestroy(() => {
        if (!hadDark) htmlEl.classList.remove('dark');
        htmlEl.style.colorScheme = prevColorScheme;
      });
    }

    // Periodic save to handle iOS app switching and form value changes
    // Uses visibilitychange event for immediate saves when app is backgrounded
    if (typeof document !== 'undefined') {
      document.addEventListener(
        'visibilitychange',
        this.handleVisibilityChange,
      );

      // Also save before page unload
      window.addEventListener('beforeunload', this.handleBeforeUnload);

      // Cleanup event listeners on destroy
      this.destroyRef.onDestroy(() => {
        document.removeEventListener(
          'visibilitychange',
          this.handleVisibilityChange,
        );
        window.removeEventListener('beforeunload', this.handleBeforeUnload);

        this.flushPendingSave();
      });
    }
  }

  /**
   * Called on form input events to trigger save.
   * Debounces saves to avoid excessive storage writes.
   */
  private saveDebounceTimeout: ReturnType<typeof setTimeout> | null = null;

  onFormInput(): void {
    const storageKey = this.activeStorageKey();
    if (!storageKey) return;

    // Debounce saves - wait 500ms after last input before saving
    if (this.saveDebounceTimeout) {
      clearTimeout(this.saveDebounceTimeout);
    }
    this.saveDebounceTimeout = setTimeout(() => {
      this.saveDebounceTimeout = null;
      this.saveFormToStorage(storageKey);
    }, 500);
  }

  // Bound event handlers for cleanup
  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      this.saveFormToStorage();
    }
  };

  private handleBeforeUnload = (): void => {
    this.saveFormToStorage();
  };

  private createForm(
    modelSignal: ReturnType<typeof signal<VettingFormModel>>,
    qs: DisplayQuestion[],
    requireConduct: boolean,
  ): VettingFormInstance {
    return form(modelSignal, (f) => {
      if (requireConduct) {
        required(f.conduct); // Check truthy, validate exact true in onSubmit
      }
      qs.forEach((q) => {
        if (q.required) {
          if (q.type === 'checkbox' && q.options) {
            validate(f[q.id], ({value}) => {
              const selected = value();
              return isStringArray(selected) && selected.length > 0
                ? null
                : requiredError();
            });
          } else {
            required(f[q.id]);
          }
        }
        if (
          q.minLength &&
          (q.type === 'text' ||
            q.type === 'long_text' ||
            q.type === 'paragraph')
        ) {
          // Type assertion needed for minLength which expects ValueWithLengthOrSize
          const fieldPath = f[q.id] as Parameters<typeof minLength>[0];
          minLength(fieldPath, q.minLength);
        }
        if (
          q.type === 'text' ||
          q.type === 'long_text' ||
          q.type === 'paragraph'
        ) {
          const fieldPath = f[q.id] as Parameters<typeof maxLength>[0];
          maxLength(fieldPath, MAX_ANSWER_STRING_LENGTH);
        }
      });
    });
  }

  onCheckboxChange(controlId: string, option: string, event: Event) {
    const checked = readInputChecked(event.target);
    if (checked === null) return;
    const formInstance = this.vettingForm();
    if (!formInstance) return;
    const field = formInstance[controlId];
    if (field) {
      const fieldState = field();
      const rawCurrent = fieldState.value();
      const current = isStringArray(rawCurrent) ? rawCurrent : [];
      if (checked) {
        if (!current.includes(option)) {
          fieldState.value.set([...current, option]);
        }
      } else {
        fieldState.value.set(current.filter((o) => o !== option));
      }
      fieldState.markAsTouched();
    }
  }

  onRadioChange(
    controlId: string,
    value: 'true' | 'false',
    event: Event,
  ): void {
    const checked = readInputChecked(event.target);
    if (checked !== true) return;

    const formInstance = this.vettingForm();
    if (!formInstance) return;

    const field = formInstance[controlId];
    if (!field || typeof field !== 'function') return;

    const fieldState = field();
    fieldState.value.set(value);
    fieldState.markAsTouched();
  }

  getField(fieldId: string): MaybeFieldTree<VettingFieldValue> | null {
    const formInstance = this.vettingForm();
    if (!formInstance) return null;
    return (
      (
        formInstance as unknown as Record<
          string,
          MaybeFieldTree<VettingFieldValue>
        >
      )[fieldId] || null
    );
  }

  // Narrowing helpers for the template to avoid 'any'
  asStringField(
    field: MaybeFieldTree<VettingFieldValue> | null,
  ): MaybeFieldTree<string> | null {
    return castSignalFormField<string>(field);
  }

  asBoolField(
    field: MaybeFieldTree<VettingFieldValue> | null,
  ): MaybeFieldTree<boolean> | null {
    return castSignalFormField<boolean>(
      field,
    );
  }

  asArrayField(
    field: MaybeFieldTree<VettingFieldValue> | null,
  ): MaybeFieldTree<string[]> | null {
    return castSignalFormField<string[]>(
      field,
    );
  }

  isRadioSelected(
    field: MaybeFieldTree<VettingFieldValue> | null,
    value: 'true' | 'false',
  ): boolean {
    if (!field || typeof field !== 'function') return false;
    return field().value() === value;
  }

  isCheckboxSelected(
    field: MaybeFieldTree<VettingFieldValue> | null,
    option: string,
  ): boolean {
    if (!field || typeof field !== 'function') return false;
    const value = field().value();
    return isStringArray(value) && value.includes(option);
  }

  isFieldInvalid(
    field: MaybeFieldTree<VettingFieldValue> | null,
    submitted: boolean,
  ): boolean {
    return isSignalFormFieldInvalid(field, submitted);
  }

  hasError(
    field: MaybeFieldTree<VettingFieldValue> | null,
    errorName: string,
  ): boolean {
    return signalFormFieldHasError(field, errorName);
  }

  getFieldErrors(field: MaybeFieldTree<VettingFieldValue> | null): string[] {
    if (!field || typeof field !== 'function') return [];
    const state = field();
    return state
      .errors()
      .map((e: {kind: string; message?: string}) => e.message ?? '')
      .filter((msg: string): msg is string => msg !== '');
  }

  /**
   * Extract raw primitive values from the form by reading each field's value signal.
   * This is necessary because Angular Signal Forms stores values as WritableSignals,
   * and the model signal may contain signal objects rather than primitives.
   */
  private extractFormValues(): Record<
    string,
    string | string[] | boolean | number
  > {
    const formInstance = this.vettingForm();
    if (!formInstance) return {};

    const questions = this.questions();
    const values: Record<string, string | string[] | boolean | number> = {};

    for (const q of questions) {
      const field = formInstance[q.id];
      if (field && typeof field === 'function') {
        const fieldState = field();
        // fieldState.value is a WritableSignal - call it to get the actual value
        const rawValue = fieldState.value();

        // Ensure we have a primitive or array of primitives
        if (rawValue === null || rawValue === undefined) {
          values[q.id] = q.type === 'checkbox' ? [] : '';
        } else if (Array.isArray(rawValue)) {
          // For checkbox arrays, ensure all items are strings
          values[q.id] = rawValue.map((v) => String(v));
        } else if (typeof rawValue === 'object') {
          // Shouldn't happen, but safeguard against nested signals/objects
          logger.warn(
            '[Vetting] Unexpected object value for field:',
            q.id,
            rawValue,
          );
          values[q.id] = String(rawValue);
        } else if (q.type === 'boolean' && typeof rawValue === 'string') {
          // Radio buttons store "true"/"false" strings — convert to actual booleans
          values[q.id] = rawValue === 'true';
        } else {
          values[q.id] = rawValue;
        }
      }
    }

    return values;
  }

  private extractDraftFormValues(): Record<string, VettingFieldValue> {
    const formInstance = this.vettingForm();
    if (!formInstance) return {};

    const values: Record<string, VettingFieldValue> = {};
    for (const q of this.activeDraftQuestions()) {
      const field = formInstance[q.id];
      if (!field || typeof field !== 'function') continue;

      const rawValue = field().value();
      if (
        typeof rawValue === 'string' ||
        typeof rawValue === 'boolean' ||
        isStringArray(rawValue)
      ) {
        values[q.id] = rawValue;
      } else {
        values[q.id] = q.type === 'checkbox' ? [] : '';
      }
    }

    return values;
  }

  async onSubmit(event?: Event) {
    event?.preventDefault();

    // Early auth check - before form validation
    // This allows showing a user-friendly error even if form state is unstable
    const user = this.auth.currentUser();
    if (!user) {
      this.errorMsg.set('You must be logged in to apply.');
      return;
    }

    const formInstance = this.vettingForm();
    if (!formInstance) return;

    // Use submit guard at top level to prevent double-click submissions
    // This ensures isSubmitting is set immediately
    await this.submitGuard.guard(async () => {
      // Check form validity ourselves - submit() doesn't await async callbacks
      // so we can't rely on it for async submission logic
      const formState = formInstance();

      // Mark all fields as touched to show validation errors
      // Angular Signal Forms doesn't have markAllAsTouched(), so iterate through fields
      const questions = this.questions();
      for (const q of questions) {
        const field = formInstance[q.id];
        if (field && typeof field === 'function') {
          field().markAsTouched();
        }
      }

      const requiresConduct = this.hasCodeOfConduct();
      if (requiresConduct) {
        const conductFieldForTouch = formInstance['conduct'];
        if (
          conductFieldForTouch &&
          typeof conductFieldForTouch === 'function'
        ) {
          conductFieldForTouch().markAsTouched();
        }
      }

      if (formState.invalid()) {
        // Form is invalid, errors will be displayed via template bindings
        return;
      }

      if (requiresConduct) {
        // Get conduct value from form field, not model
        const conductField = formInstance['conduct'];
        const conductValue =
          conductField && typeof conductField === 'function'
            ? conductField().value()
            : false;

        if (!conductValue) {
          this.errorMsg.set(
            'You must agree to the Code of Conduct to continue.',
          );
          return;
        }
      }

      this.errorMsg.set('');

      try {
        // Extract values directly from form fields, not the model signal
        const answers = this.extractFormValues();

        logger.debug('[Vetting] Extracted form values:', answers);

        // Use organizerIdFromResource - the organizerId captured when questions loaded,
        // not the current route param which could have changed
        const appData = {
          organizerId: this.organizerIdFromResource() || undefined,
          answers: {
            ...answers,
            source: 'web',
          },
        };

        logger.debug('[Vetting] Final appData:', appData);

        await this.appsService.create(appData);
        // Trigger dashboard refresh before navigating to ensure fresh data is loaded
        this.dashboardData.triggerRefresh();

        // Clear saved form data since submission was successful
        this.clearFormStorage();

        // Show success state immediately - provides visual feedback even if toast fails
        this.submissionComplete.set(true);

        // Show success toast to confirm submission
        toast.success('application sent', {
          description: 'taking you home...',
          duration: 3000,
        });

        // Brief delay to let user see success state before navigation
        // This ensures users on slow devices/connections see confirmation
        await new Promise((resolve) => setTimeout(resolve, 1500));

        await this.router.navigate(['/']);
      } catch (err: unknown) {
        logger.error('Operation failed', err);
        const error =
          err instanceof ConvexError && typeof err.data === 'string'
            ? err.data
            : err instanceof Error
              ? err.message
              : 'Something went wrong';
        this.errorMsg.set(error);

        // Also show error toast for visibility
        toast.error('Submission failed', {
          description: error,
          duration: 6000,
        });
      }
    });
  }
}
