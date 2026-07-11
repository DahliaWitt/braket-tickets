import {
  Component,
  inject,
  signal,
  computed,
  effect,
  untracked,
  linkedSignal,
  resource,
  ChangeDetectionStrategy,
  input,
  DestroyRef,
} from '@angular/core';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {
  form,
  FormField,
  required,
  maxLength,
  validate,
  type MaybeFieldTree,
} from '@angular/forms/signals';
import {ConvexError} from 'convex/values';
import {type HasUnsavedChanges} from '../../guards/unsaved-changes.guard';
import {AuthService} from '@/core/services/auth.service';
import {CommunitiesService} from '@/core/services/communities.service';
import {EventsService} from '@/features/admin/services/events.service';
import {CommunityContextService} from '@/features/admin/services/community-context.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {BraDatePickerComponent} from '@ui/components/composites/date-picker/date-picker.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {EventPosterUploaderComponent} from '@/features/admin/components/event-poster-uploader/event-poster-uploader.component';
import {
  EventPublishDialogComponent,
  type PublishedEvent,
} from '@/features/admin/components/event-publish-dialog/event-publish-dialog.component';
import {
  formatDateYmd,
  isDateDirty,
  formatEventTimeInput,
  parseEventDateInEventTimeZone,
  combineLocalEventDateTime,
  isLocalEventDateTimeValid,
} from '@/features/admin/utils/event-date.utils';
import {type EditableEvent} from '@/core/models/event.types';
import {type Id} from '@convex/_generated/dataModel';
import {
  EVENT_VISIBILITY,
  type EventVisibility,
} from '@shared/domain/event-visibility';
import {
  MAX_EVENT_TITLE_LENGTH,
  MAX_EVENT_DURATION_DAYS,
  MAX_EVENT_DURATION_MS,
} from '@shared/constants';
import {extractConvexErrorMessage} from '@/core/utils/error-message.utils';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';
import {getTodayInEventTimeZone} from '@/utils/event-date-format';
import {
  isSignalFormFieldInvalid,
  signalFormFieldHasError,
  signalFormFieldErrorMessage,
  notBlank,
} from '@/utils/signal-form';

interface EventFormModel {
  title: string;
  date: Date | null;
  time: string;
  endDate: Date | null;
  endTime: string;
  location: string;
  description: string;
  price: string; // String for input compatibility
  totalTickets: string; // String for input compatibility
  slidingScaleEnabled: boolean;
  slidingScaleMin: string;
  slidingScaleMax: string;
  supporterDefaultPrice: string;
  maxTicketsPerUser: string;
  organizerId: string;
  visibility: EventVisibility;
}

interface LoadedEventState {
  event: EditableEvent;
  currentPosterUrl: string | null;
  eventModel: EventFormModel;
}

interface EventEditorSourceState {
  id: string | undefined;
  loadedState: LoadedEventState | undefined;
  createOrganizerId: string;
}

interface ResolvedCreateCommunityScope {
  id: Id<'organizers'>;
  name: string;
}

const DEFAULT_NOTAFLOF_MAX_AMOUNT = '10';
const STRICT_USD_AMOUNT_PATTERN = /^(?:\d+|\d+\.\d{1,2}|\.\d{1,2})$/;
const INVALID_USD_AMOUNT_MESSAGE = 'Use a dollar amount like 20 or 20.00';

type StrictUsdParseResult =
  | {valid: true; cents: number}
  | {valid: false; reason: 'blank' | 'negative' | 'invalid'};

function startOfToday(): Date {
  return getTodayInEventTimeZone();
}

function createEmptyEventFormModel(organizerId = ''): EventFormModel {
  return {
    title: '',
    date: null,
    time: '20:00',
    endDate: null,
    endTime: '',
    location: '',
    description: '',
    price: '0',
    totalTickets: '100',
    slidingScaleEnabled: false,
    slidingScaleMin: '0',
    slidingScaleMax: DEFAULT_NOTAFLOF_MAX_AMOUNT,
    supporterDefaultPrice: '5',
    maxTicketsPerUser: '4',
    organizerId,
    visibility: 'private',
  };
}

function parseStrictUsdCents(value: string): StrictUsdParseResult {
  const trimmed = value.trim();
  if (trimmed === '') {
    return {valid: false, reason: 'blank'};
  }

  if (trimmed.startsWith('-')) {
    return {valid: false, reason: 'negative'};
  }

  if (!STRICT_USD_AMOUNT_PATTERN.test(trimmed)) {
    return {valid: false, reason: 'invalid'};
  }

  const [dollarsPart, centsPart = ''] = trimmed.split('.');
  const dollars = dollarsPart === '' ? 0 : Number(dollarsPart);
  const cents = Number(centsPart.padEnd(2, '0'));
  return {valid: true, cents: dollars * 100 + cents};
}

function parseOptionalStrictUsdCents(value: string): number | undefined {
  const parsed = parseStrictUsdCents(value);
  return parsed.valid ? parsed.cents : undefined;
}

function invalidUsdAmountError(
  value: string,
): {kind: string; message: string} | null {
  const parsed = parseStrictUsdCents(value);
  if (parsed.valid || parsed.reason === 'blank') {
    return null;
  }

  if (parsed.reason === 'negative') {
    return {
      kind: 'negativePrice',
      message: 'Price cannot be negative',
    };
  }

  return {
    kind: 'invalidDecimal',
    message: INVALID_USD_AMOUNT_MESSAGE,
  };
}

function invalidOptionalUsdAmountError(
  value: string,
): {kind: string; message: string} | null {
  const parsed = parseStrictUsdCents(value);
  return parsed.valid || parsed.reason === 'blank'
    ? null
    : {
        kind: 'invalidDecimal',
        message: INVALID_USD_AMOUNT_MESSAGE,
      };
}

function requireStrictUsdCents(value: string, field: string): number {
  const parsed = parseStrictUsdCents(value);
  if (!parsed.valid) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed.cents;
}

function parseOptionalWholeNumber(value: string): number | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : Math.trunc(Number(trimmed));
}

function buildEventFormModel(evt: EditableEvent): EventFormModel {
  const parsedDate = parseEventDateInEventTimeZone(evt.date);

  if (!parsedDate) {
    logger.warn(
      '[EventEditor] Event date could not be parsed, form will be invalid:',
      evt.date,
    );
  }

  return {
    title: evt.title,
    date: parsedDate,
    time: formatEventTimeInput(evt.date),
    endDate: evt.endDate ? parseEventDateInEventTimeZone(evt.endDate) : null,
    endTime: evt.endDate ? formatEventTimeInput(evt.endDate) : '',
    location: evt.location || '',
    description: evt.description || '',
    price: String((evt.price || 0) / 100),
    totalTickets: String(evt.totalTickets ?? 100),
    slidingScaleEnabled: evt.slidingScaleEnabled || false,
    slidingScaleMin: String((evt.slidingScaleMin || 0) / 100),
    slidingScaleMax: String((evt.slidingScaleMax || 0) / 100),
    supporterDefaultPrice: String((evt.supporterDefaultPrice || 0) / 100),
    maxTicketsPerUser: String(evt.maxTicketsPerUser ?? 4),
    organizerId: evt.organizerId ?? '',
    visibility: evt.visibility ?? 'private',
  };
}

function resolveFormModelFromSource(
  source: EventEditorSourceState,
  previous?: {source: EventEditorSourceState; value: EventFormModel},
): EventFormModel {
  if (source.loadedState) {
    return source.loadedState.eventModel;
  }

  if (!source.id) {
    if (!previous || previous.source.id !== undefined) {
      return createEmptyEventFormModel(source.createOrganizerId);
    }

    if (
      previous.source.createOrganizerId !== source.createOrganizerId &&
      source.createOrganizerId
    ) {
      return {...previous.value, organizerId: source.createOrganizerId};
    }

    return previous.value;
  }

  return previous?.value ?? createEmptyEventFormModel(source.createOrganizerId);
}

function humanizeSaveError(message: string | null): string | null {
  const knownMessages: Record<string, string> = {
    scheduled_too_far: 'Choose a send time within the next 90 days.',
    scheduled_too_soon: 'Choose a send time at least 1 minute from now.',
  };

  return message ? (knownMessages[message] ?? message) : null;
}

@Component({
  selector: 'app-event-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormField,
    ZardButtonComponent,
    ZardCardComponent,
    BraDatePickerComponent,
    ZardSkeletonComponent,
    EventPosterUploaderComponent,
    EventPublishDialogComponent,
  ],
  templateUrl: './event-editor.component.html',
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
        background: hsl(var(--background));
      }
    `,
  ],
})
export class EventEditorComponent implements HasUnsavedChanges {
  /** Template-accessible enum for visibility comparisons */
  protected readonly EVENT_VISIBILITY = EVENT_VISIBILITY;

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private auth = inject(AuthService);
  private communitiesService = inject(CommunitiesService);
  private eventsService = inject(EventsService);
  private destroyRef = inject(DestroyRef);

  /** Tracks the current upload's AbortController for cancellation on file change or destroy */
  private readonly uploadAbortController = signal<AbortController | null>(null);

  /** Events list route — always community admin since admin dashboard no longer has an events tab */
  readonly eventsListRoute = '/community-admin/events';

  /** Event management route prefix — always community admin since admin dashboard no longer has an events tab */
  readonly eventManagementRoutePrefix = '/community-admin';
  readonly eventsListQueryParams = computed(() => {
    const community = this.route.snapshot.queryParamMap.get('community');
    return community ? {community} : null;
  });

  /**
   * Community context — provided at the community-admin shell level.
   * Optional inject so the editor also works under /admin routes (fallback to event's own organizerId).
   */
  private communityContext = inject(CommunityContextService, {optional: true});

  readonly id = input<string>();

  // Consistent styling for manually controlled inputs (replacing ZardInputDirective)
  readonly inputClasses =
    'font-sans border rounded-sm px-3 py-2 bg-background border-border text-foreground w-full focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors placeholder:text-muted-foreground/40 disabled:opacity-50 disabled:cursor-not-allowed';
  readonly errorClasses =
    'border-destructive/50 text-destructive-text focus:ring-destructive/50';

  readonly isCreateMode = computed(() => !this.id());

  private readonly editEventResource = resource({
    params: () => {
      const id = this.id();
      return id ? {id} : undefined;
    },
    loader: async ({params}): Promise<LoadedEventState> => {
      try {
        const event = await this.eventsService.getOneForEdit(params.id);
        return {
          event,
          currentPosterUrl: event.poster
            ? this.eventsService.getPosterUrl(event, event.poster, {
                thumb: '400x400',
              })
            : null,
          eventModel: buildEventFormModel(event),
        };
      } catch (error) {
        logger.error('Error loading event', error);
        throw error;
      }
    },
  });

  private readonly createCommunityScopeParam = computed(() => {
    if (!this.isCreateMode()) return undefined;
    return this.route.snapshot.queryParamMap.get('community') ?? undefined;
  });

  private readonly createCommunityScopeResource = resource({
    params: () => {
      const community = this.createCommunityScopeParam();
      return community ? {community} : undefined;
    },
    loader: async ({params}): Promise<ResolvedCreateCommunityScope> => {
      const community = await this.communitiesService.getBySlugOrId(
        params.community,
      );
      if (!community) {
        throw new Error(`Community not found: ${params.community}`);
      }

      return {id: community._id, name: community.name};
    },
  });

  private readonly resolvedCreateCommunityScope = computed(
    () => safeResourceValue(this.createCommunityScopeResource) ?? null,
  );

  private readonly createCommunityScopeSync = effect(() => {
    const scope = this.resolvedCreateCommunityScope();
    if (!scope || !this.isCreateMode()) return;

    this.communityContext?.selectCommunity(scope.id);
    this.communityContext?.setResolvedNames(new Map([[scope.id, scope.name]]));
  });

  readonly createCommunityScopeMessage = computed(() => {
    const community = this.createCommunityScopeParam();
    if (!community) return null;

    if (this.createCommunityScopeResource.error()) {
      return `Could not resolve community "${community}". Go back to events and pick a valid community.`;
    }

    if (!this.resolvedCreateCommunityScope()) {
      return 'Resolving community scope...';
    }

    return null;
  });

  readonly isCreateCommunityScopeBlocking = computed(() => {
    return (
      this.createCommunityScopeParam() !== undefined &&
      this.resolvedCreateCommunityScope() === null
    );
  });

  private readonly createOrganizerId = computed(() => {
    if (!this.isCreateMode()) return '';

    const community = this.createCommunityScopeParam();
    if (community) {
      return this.resolvedCreateCommunityScope()?.id ?? '';
    }

    return this.communityContext?.selectedCommunityId() ?? '';
  });

  private readonly editorSourceState = computed<EventEditorSourceState>(() => ({
    id: this.id(),
    loadedState: safeResourceValue(this.editEventResource),
    createOrganizerId: this.createOrganizerId(),
  }));

  // Signal-based form model (using strings for number inputs for HTML compatibility)
  readonly eventModel = linkedSignal<EventEditorSourceState, EventFormModel>({
    source: this.editorSourceState,
    computation: (source, previous) =>
      resolveFormModelFromSource(source, previous),
  });

  // Pure Signal Form
  readonly eventForm = form(this.eventModel, (f) => {
    required(f.title);
    notBlank(f.title);
    maxLength(f.title, MAX_EVENT_TITLE_LENGTH, {
      message: `Title cannot exceed ${MAX_EVENT_TITLE_LENGTH} characters`,
    });

    required(f.date);
    required(f.time);
    validate(f.time, (ctx) => {
      const date = ctx.valueOf(f.date);
      const time = ctx.value();
      if (!date || !time) return null;

      return isLocalEventDateTimeValid(date, time)
        ? null
        : {
            kind: 'invalidEventTime',
            message: 'Choose a valid time for this date',
          };
    });
    validate(f.date, ({value}) => {
      const date = value();
      if (!date) return null;

      const isPast = date.getTime() < this.minimumEventDate().getTime();
      if (!isPast) return null;

      if (this.isCreateMode()) {
        return {
          kind: 'pastDate',
          message: 'Date cannot be in the past',
        };
      }

      return isDateDirty(date, this.pristineModel().date)
        ? {
            kind: 'pastDate',
            message: 'Date cannot be in the past',
          }
        : null;
    });

    validate(f.endTime, (ctx) => {
      const endDate = ctx.valueOf(f.endDate);
      const endTime = ctx.value();
      if (!endDate && !endTime) return null;
      if (!endDate || !endTime) {
        return {
          kind: 'endDateTimePair',
          message: 'Set both end date and time, or clear both',
        };
      }
      if (!isLocalEventDateTimeValid(endDate, endTime)) {
        return {
          kind: 'invalidEventTime',
          message: 'Choose a valid time for this date',
        };
      }

      const startDate = ctx.valueOf(f.date);
      const startTime = ctx.valueOf(f.time);
      if (
        !startDate ||
        !startTime ||
        !isLocalEventDateTimeValid(startDate, startTime)
      ) {
        return null;
      }

      const start = combineLocalEventDateTime(startDate, startTime);
      const end = combineLocalEventDateTime(endDate, endTime);
      if (end.getTime() <= start.getTime()) {
        return {
          kind: 'endBeforeStart',
          message: 'End date must be after the event start',
        };
      }
      // Mirror the backend cap (and its wording) so an over-long span is caught
      // before submit.
      if (end.getTime() - start.getTime() > MAX_EVENT_DURATION_MS) {
        return {
          kind: 'endTooFar',
          message: `End date must be within ${MAX_EVENT_DURATION_DAYS} days of the event start`,
        };
      }
      return null;
    });

    required(f.price);
    validate(f.price, ({value}) => {
      return invalidUsdAmountError(value());
    });

    validate(f.totalTickets, ({value}) => {
      const tickets = value().trim();
      if (tickets === '') {
        return {
          kind: 'minTickets',
          message: 'Must have at least 1 ticket',
        };
      }

      const num = Number(tickets);
      if (Number.isNaN(num) || !Number.isInteger(num)) {
        return {
          kind: 'wholeNumber',
          message: 'Must be a whole number',
        };
      }

      return num < 1
        ? {
            kind: 'minTickets',
            message: 'Must have at least 1 ticket',
          }
        : null;
    });

    validate(f.maxTicketsPerUser, ({value}) => {
      const maxTicketsPerUser = value().trim();
      if (maxTicketsPerUser === '') return null;

      const num = Number(maxTicketsPerUser);
      return Number.isNaN(num) || !Number.isInteger(num)
        ? {
            kind: 'wholeNumber',
            message: 'Must be a whole number',
          }
        : null;
    });

    validate(f.maxTicketsPerUser, ({value}) => {
      const v = value().trim();
      if (v === '') return null;
      const num = Number(v);
      if (Number.isNaN(num) || !Number.isInteger(num)) return null;
      return num < 1 ? {kind: 'minValue', message: 'Must be at least 1'} : null;
    });

    validate(f.supporterDefaultPrice, (ctx) => {
      const supporterError = invalidOptionalUsdAmountError(ctx.value());
      if (supporterError) return supporterError;

      const supporter = parseStrictUsdCents(ctx.value());
      const price = parseStrictUsdCents(ctx.valueOf(f.price));
      if (!supporter.valid || !price.valid) return null;

      return supporter.cents > 0 && supporter.cents <= price.cents
        ? {
            kind: 'supporterPrice',
            message: 'Must be greater than base price',
          }
        : null;
    });

    validate(f.slidingScaleMin, (ctx) => {
      return ctx.valueOf(f.slidingScaleEnabled)
        ? invalidOptionalUsdAmountError(ctx.value())
        : null;
    });

    validate(f.slidingScaleMax, (ctx) => {
      return ctx.valueOf(f.slidingScaleEnabled)
        ? invalidOptionalUsdAmountError(ctx.value())
        : null;
    });

    required(f.organizerId, {when: () => this.isCreateMode()});
  });

  readonly isLoading = computed(
    () => this.editEventResource.status() === 'loading',
  );
  readonly isSubmitting = signal(false);
  readonly error = computed(() =>
    this.editEventResource.error() ? 'Failed to load event data' : null,
  );
  readonly submitError = signal<string | null>(null);
  readonly submitted = signal(false);

  /** Snapshot of the model at load time — used to detect user edits */
  private readonly pristineModel = linkedSignal<
    EventEditorSourceState,
    EventFormModel
  >({
    source: this.editorSourceState,
    computation: (source, previous) =>
      resolveFormModelFromSource(source, previous),
  });

  /** Bypasses the dirty guard after a successful save (navigation is intentional) */
  private readonly justSaved = signal(false);

  /** Whether the form has unsaved user edits — used by the canDeactivate guard */
  readonly isDirty = computed(() => {
    if (this.justSaved()) return false;
    const current = this.eventModel();
    const pristine = this.pristineModel();
    const compareSlidingScaleAmounts =
      current.slidingScaleEnabled || pristine.slidingScaleEnabled;
    return (
      current.title !== pristine.title ||
      current.location !== pristine.location ||
      current.description !== pristine.description ||
      current.time !== pristine.time ||
      current.price !== pristine.price ||
      current.totalTickets !== pristine.totalTickets ||
      current.slidingScaleEnabled !== pristine.slidingScaleEnabled ||
      (compareSlidingScaleAmounts &&
        current.slidingScaleMin !== pristine.slidingScaleMin) ||
      (compareSlidingScaleAmounts &&
        current.slidingScaleMax !== pristine.slidingScaleMax) ||
      current.supporterDefaultPrice !== pristine.supporterDefaultPrice ||
      current.maxTicketsPerUser !== pristine.maxTicketsPerUser ||
      current.organizerId !== pristine.organizerId ||
      current.visibility !== pristine.visibility ||
      this.hasPosterChange() ||
      isDateDirty(current.date, pristine.date) ||
      current.endTime !== pristine.endTime ||
      isDateDirty(current.endDate, pristine.endDate)
    );
  });

  readonly event = computed(
    () => safeResourceValue(this.editEventResource)?.event ?? null,
  );
  readonly currentPosterUrl = computed(
    () => safeResourceValue(this.editEventResource)?.currentPosterUrl ?? null,
  );
  readonly uploadProgress = signal<number | null>(null);

  // ── Publish dialog state ────────────────────────────────────────────
  readonly showPublishDialog = signal(false);

  // ── Poster state ────────────────────────────────────────────────────
  readonly posterFile = signal<File | null>(null);
  readonly hasPosterChange = signal(false);

  /** Display name of the auto-scoped community, or null if unavailable */
  readonly communityName = computed(() => {
    const community = this.createCommunityScopeParam();
    if (community) {
      return this.resolvedCreateCommunityScope()?.name ?? null;
    }

    return this.communityContext?.selectedCommunityName() ?? null;
  });

  readonly maxEventTitleLength = MAX_EVENT_TITLE_LENGTH;
  readonly eventTitleWarningLength = Math.floor(MAX_EVENT_TITLE_LENGTH * 0.9);

  readonly minimumEventDate = computed(() => startOfToday());

  // Form validity computed
  readonly isFormValid = computed(() => {
    return (
      !this.isCreateCommunityScopeBlocking() && !this.eventForm().invalid()
    );
  });

  /**
   * Set once the user edits the supporter-price field, so the create-mode
   * auto-fill effect stops overwriting their in-progress input. Bound to the
   * input's native `(input)` event alongside the Signal Forms field directive.
   */
  private readonly supporterPriceTouched = signal(false);

  /** Marks the supporter-price field as user-edited (see field above). */
  onSupporterPriceInput(): void {
    this.supporterPriceTouched.set(true);
  }

  constructor() {
    // Auto-fill the supporter default price from the base price in create mode,
    // but only until the user starts editing the supporter field themselves.
    // Reacting to a memoized `price` computed (not the whole eventModel) keeps
    // supporter-field keystrokes from re-running this effect, and the touched
    // guard prevents it from clobbering in-progress input. Edit mode never
    // auto-fills.
    const basePriceInput = computed(() => this.eventModel().price);
    effect(() => {
      const price = basePriceInput();
      if (!this.isCreateMode()) return;
      if (this.supporterPriceTouched()) return;
      const priceResult = parseStrictUsdCents(price);
      if (!priceResult.valid) return;
      const supporterResult = parseStrictUsdCents(
        untracked(() => this.eventModel().supporterDefaultPrice),
      );
      if (!supporterResult.valid && supporterResult.reason !== 'blank') return;

      const supporterCents = supporterResult.valid ? supporterResult.cents : 0;
      if (supporterCents === 0 || supporterCents <= priceResult.cents) {
        this.eventModel.update((m) => ({
          ...m,
          supporterDefaultPrice: String(priceResult.cents / 100 + 5),
        }));
      }
    });
  }

  isFieldInvalid<T>(field: MaybeFieldTree<T>): boolean {
    return isSignalFormFieldInvalid(field, this.submitted());
  }

  hasError<T>(field: MaybeFieldTree<T>, errorKind: string): boolean {
    return signalFormFieldHasError(field, errorKind);
  }

  /** First end-window validation message, or null when the end fields are valid. */
  protected endWindowError(): string | null {
    return signalFormFieldErrorMessage(this.eventForm.endTime, [
      'endDateTimePair',
      'invalidEventTime',
      'endBeforeStart',
      'endTooFar',
    ]);
  }

  toggleSlidingScale(event: Event) {
    const target = event.target;
    if (!target || typeof target !== 'object' || !('checked' in target)) return;
    const {checked} = target;
    if (typeof checked !== 'boolean') return;
    this.eventModel.update((m) => ({
      ...m,
      slidingScaleEnabled: checked,
      slidingScaleMax:
        checked && (parseOptionalStrictUsdCents(m.slidingScaleMax) ?? 0) <= 0
          ? DEFAULT_NOTAFLOF_MAX_AMOUNT
          : m.slidingScaleMax,
    }));
  }

  setVisibility(visibility: EventVisibility): void {
    this.eventModel.update((m) => ({...m, visibility}));
  }

  preventNumericInputWheel(event: WheelEvent): void {
    // Native number inputs mutate on wheel while focused, which can silently
    // change prices or inventory while the user is trying to scroll the page.
    event.preventDefault();
    const target = event.currentTarget;
    if (target instanceof HTMLElement) {
      target.blur();
    }
  }

  save(status: 'draft' | 'published') {
    if (this.isCreateCommunityScopeBlocking()) {
      this.submitted.set(true);
      this.submitError.set(
        this.createCommunityScopeMessage() ??
          'Resolve the community scope before saving.',
      );
      return;
    }

    const shouldConfirmPublish =
      status === 'published' &&
      (this.isCreateMode() || this.event()?.status !== 'published');

    if (shouldConfirmPublish) {
      this.showPublishDialog.set(true);
    } else {
      void this.onSubmit(status);
    }
  }

  /** Called when the publish dialog emits a published event (user confirmed). */
  onPublished(announcement: PublishedEvent): void {
    void this.onSubmit('published', announcement);
  }

  async onSubmit(
    targetStatus: 'draft' | 'published' = 'published',
    announcement?: PublishedEvent,
  ) {
    if (this.isSubmitting()) return;

    this.submitted.set(true);
    this.submitError.set(null);

    if (this.isCreateCommunityScopeBlocking()) {
      this.submitError.set(
        this.createCommunityScopeMessage() ??
          'Resolve the community scope before saving.',
      );
      return;
    }

    if (!this.isFormValid()) {
      this.submitError.set('Fix the highlighted fields before saving.');
      return;
    }

    // Edit mode requires existing event
    if (!this.isCreateMode() && !this.event()) {
      this.submitError.set(
        'Event data is still loading. Try again in a moment.',
      );
      return;
    }

    this.isSubmitting.set(true);

    // Create AbortController for upload cancellation on destroy or file change
    const abortController = new AbortController();
    this.uploadAbortController.set(abortController);
    const abortOnDestroy = this.destroyRef.onDestroy(() =>
      abortController.abort(),
    );

    try {
      const formValue = this.eventModel();
      const date = formValue.date;

      if (!date) {
        this.submitError.set('Choose an event date before saving.');
        return;
      }

      const priceCents = requireStrictUsdCents(formValue.price, 'price');
      const supporterDefaultPrice = parseOptionalStrictUsdCents(
        formValue.supporterDefaultPrice,
      );
      const maxTicketsPerUser = parseOptionalWholeNumber(
        formValue.maxTicketsPerUser,
      );
      const slidingScaleMin = parseOptionalStrictUsdCents(
        formValue.slidingScaleMin,
      );
      const slidingScaleMax = parseOptionalStrictUsdCents(
        formValue.slidingScaleMax,
      );

      const sliderConfig = formValue.slidingScaleEnabled
        ? {
            enabled: true,
            ...(slidingScaleMin !== undefined ? {min: slidingScaleMin} : {}),
            ...(slidingScaleMax !== undefined ? {max: slidingScaleMax} : {}),
          }
        : undefined;

      const endDateArg =
        formValue.endDate && formValue.endTime
          ? formatDateYmd(
              combineLocalEventDateTime(formValue.endDate, formValue.endTime),
            )
          : undefined;

      const trimmedLocation = formValue.location.trim();
      const trimmedDescription = formValue.description.trim();

      const baseArgs = {
        title: formValue.title,
        date: formatDateYmd(combineLocalEventDateTime(date, formValue.time)),
        ...(endDateArg !== undefined ? {endDate: endDateArg} : {}),
        // Present values only; the edit path re-adds an explicit `null` clear
        // for emptied fields (create omits them entirely).
        ...(trimmedLocation ? {location: trimmedLocation} : {}),
        ...(trimmedDescription ? {description: trimmedDescription} : {}),
        price: priceCents,
        totalTickets: Math.trunc(Number(formValue.totalTickets)),
        ...(supporterDefaultPrice !== undefined ? {supporterDefaultPrice} : {}),
        ...(maxTicketsPerUser !== undefined ? {maxTicketsPerUser} : {}),
        status: targetStatus,
        sliderConfig,
        visibility: formValue.visibility,
        announcement: targetStatus === 'published' ? announcement : undefined,
      };

      if (this.isCreateMode()) {
        this.uploadProgress.set(0);
        const createdEventId = await this.eventsService.createWithPoster(
          {...baseArgs, organizerId: formValue.organizerId as Id<'organizers'>},
          this.posterFile() || undefined,
          (pct) => this.uploadProgress.set(pct),
          abortController.signal,
        );
        toast.success(
          targetStatus === 'draft'
            ? 'Draft saved successfully'
            : 'Event published successfully',
        );
        this.justSaved.set(true);
        await this.navigateToEventManagementAfterCreate(createdEventId);
      } else {
        this.uploadProgress.set(0);
        await this.eventsService.updateWithPoster(
          {
            id: this.event()!._id,
            ...baseArgs,
            // Explicit null clears a previously stored value; baseArgs omits
            // emptied optional fields, so the update path re-adds the clear.
            ...(endDateArg === undefined ? {endDate: null} : {}),
            ...(trimmedLocation ? {} : {location: null}),
            ...(trimmedDescription ? {} : {description: null}),
            ...(supporterDefaultPrice === undefined
              ? {supporterDefaultPrice: null}
              : {}),
            ...(maxTicketsPerUser === undefined
              ? {maxTicketsPerUser: null}
              : {}),
            organizerId: (formValue.organizerId || undefined) as
              | Id<'organizers'>
              | undefined,
          },
          this.posterFile() || undefined,
          (pct) => this.uploadProgress.set(pct),
          abortController.signal,
        );
        toast.success(
          targetStatus === 'draft'
            ? 'Draft saved successfully'
            : 'Event updated successfully',
        );
        this.posterFile.set(null);
        this.hasPosterChange.set(false);
        this.pristineModel.set(formValue);
        this.editEventResource.reload();
      }
    } catch (err) {
      // Don't show error toast for aborted uploads (file changed or component destroyed)
      if (err instanceof DOMException && err.name === 'AbortError') {
        logger.debug(
          'Upload aborted due to file change or component destruction',
        );
        return;
      }
      logger.error('Error saving event', err);
      let message = this.isCreateMode()
        ? 'Failed to create event'
        : 'Failed to update event';
      if (err instanceof ConvexError) {
        const convexMessage = extractConvexErrorMessage(err);
        if (convexMessage) {
          message = humanizeSaveError(convexMessage) ?? convexMessage;
        }
      }
      this.submitError.set(message);
      toast.error(message);
    } finally {
      abortOnDestroy();
      this.uploadAbortController.set(null);
      this.isSubmitting.set(false);
      this.uploadProgress.set(null);
    }
  }

  private async navigateToEventManagementAfterCreate(
    eventId: Id<'events'>,
  ): Promise<void> {
    const message = 'Event saved, but we could not open event management.';
    try {
      const queryParams = this.eventsListQueryParams();
      const didNavigate = await this.router.navigate(
        [this.eventManagementRoutePrefix, 'events', eventId, 'manage'],
        queryParams ? {queryParams} : undefined,
      );
      if (didNavigate === false) {
        this.submitError.set(message);
        toast.error(message);
      }
    } catch (error) {
      logger.error('Event saved but navigation failed', error);
      this.submitError.set(message);
      toast.error(message);
    }
  }

  /** Called by the poster uploader child when a file is selected or cleared. */
  onPosterFileChanged(file: File | null): void {
    // Abort any in-progress upload when file selection changes
    const currentController = this.uploadAbortController();
    if (currentController) {
      currentController.abort();
    }

    this.posterFile.set(file);
    this.hasPosterChange.set(file !== null);
  }
}
