import {
  computed,
  signal,
  type Signal,
  type WritableSignal,
} from '@angular/core';
import type {CommunityPublicationStatus} from '@shared/domain/community-publication-status';

export interface CommunityProfileFormValue {
  name: string;
  email: string;
  contactInfo: string;
  description: string;
  website: string;
  slug: string;
  status: CommunityPublicationStatus;
  isPublicDirectory: boolean;
  codeOfConduct: string;
}

export function getOrganizerStatus(
  status: CommunityPublicationStatus | undefined,
  vettingQuestions: {id: string}[] | undefined,
): CommunityPublicationStatus {
  if (status) return status;
  return vettingQuestions && vettingQuestions.length > 0
    ? 'published'
    : 'draft';
}

export interface VettingQuestionFormValue {
  id: string;
  question: string;
  type: string;
  required: boolean;
  options: string[];
  optionsString: string;
}

function createEmptyVettingQuestion(): VettingQuestionFormValue {
  return {
    id: crypto.randomUUID(),
    question: '',
    type: 'text',
    required: true,
    options: [],
    optionsString: '',
  };
}

export function isProfileDirty(
  current: CommunityProfileFormValue,
  pristine: CommunityProfileFormValue,
  logoFile: File | null,
  isLogoRemoved: boolean,
): boolean {
  return (
    current.name !== pristine.name ||
    current.email !== pristine.email ||
    current.contactInfo !== pristine.contactInfo ||
    current.description !== pristine.description ||
    current.website !== pristine.website ||
    current.slug !== pristine.slug ||
    current.status !== pristine.status ||
    current.isPublicDirectory !== pristine.isPublicDirectory ||
    current.codeOfConduct !== pristine.codeOfConduct ||
    logoFile !== null ||
    isLogoRemoved
  );
}

export function buildDigestHourOptions(): {utcHour: number; label: string}[] {
  return Array.from({length: 24}, (_, i) => {
    const date = new Date();
    date.setUTCHours(i, 0, 0, 0);
    const localHour = date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return {utcHour: i, label: localHour};
  });
}

export function normalizeVettingQuestionsForSave(
  questions: VettingQuestionFormValue[],
): {
  id: string;
  question: string;
  type: 'text' | 'long_text' | 'boolean' | 'select' | 'checkbox';
  required: boolean;
  options?: string[];
}[] {
  return questions.map((q) => {
    const options = q.optionsString
      ? q.optionsString
          .split(',')
          .map((s) => s.trim())
          .filter((s) => !!s)
      : (q.options ?? []);

    return {
      id: q.id || crypto.randomUUID(),
      question: q.question,
      type: q.type as 'text' | 'long_text' | 'boolean' | 'select' | 'checkbox',
      required: q.required,
      options: options.length > 0 ? options : undefined,
    };
  });
}

export function addVettingQuestion(
  questions: VettingQuestionFormValue[],
): VettingQuestionFormValue[] {
  return [...questions, createEmptyVettingQuestion()];
}

export function removeVettingQuestion(
  questions: VettingQuestionFormValue[],
  index: number,
): VettingQuestionFormValue[] {
  return questions.filter((_, i) => i !== index);
}

export function moveVettingQuestion(
  questions: VettingQuestionFormValue[],
  index: number,
  direction: -1 | 1,
): VettingQuestionFormValue[] {
  const target = index + direction;
  const copy = [...questions];
  if (target < 0 || target >= copy.length) return questions;
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

export function onVettingQuestionTypeChange(
  questions: VettingQuestionFormValue[],
  index: number,
  value: string,
): VettingQuestionFormValue[] {
  questions[index].type = value;
  return [...questions];
}

export function onVettingQuestionFieldChange(
  questions: VettingQuestionFormValue[],
  index: number,
  field: 'question' | 'optionsString',
  value: string,
): VettingQuestionFormValue[] {
  questions[index][field] = value;
  return [...questions];
}

export function onVettingQuestionRequiredChange(
  questions: VettingQuestionFormValue[],
  index: number,
  checked: boolean,
): VettingQuestionFormValue[] {
  questions[index].required = checked;
  return [...questions];
}

export function needsVettingOptions(type: string | undefined): boolean {
  return type === 'select' || type === 'checkbox';
}

// ---------------------------------------------------------------------------
// Door staff member search (combobox)
// ---------------------------------------------------------------------------

export type ScannerResultStatus = 'admin' | 'added' | null;

/** True when the trimmed search term looks like an email address. */
export function isScannerSearchEmailLike(trimmedTerm: string): boolean {
  return trimmedTerm.includes('@');
}

/** Whether the results/fallback/empty panel should render at all. */
export function shouldShowScannerSearchPanel(trimmedTerm: string): boolean {
  return trimmedTerm.length > 0;
}

/**
 * Whether the "add by exact email" fallback row should render.
 *
 * `resultsAreCurrent` gates this so a stale/in-flight window (results still
 * reflecting the previous term) cannot momentarily show the fallback for a
 * term whose real results have not arrived yet.
 */
export function shouldShowScannerEmailFallback(args: {
  trimmedTerm: string;
  resultsAreCurrent: boolean;
  resultCount: number;
}): boolean {
  return (
    shouldShowScannerSearchPanel(args.trimmedTerm) &&
    isScannerSearchEmailLike(args.trimmedTerm) &&
    args.resultsAreCurrent &&
    args.resultCount === 0
  );
}

/** Whether the "no members match" empty state should render. */
export function shouldShowScannerSearchEmptyState(args: {
  trimmedTerm: string;
  resultsAreCurrent: boolean;
  resultCount: number;
}): boolean {
  return (
    shouldShowScannerSearchPanel(args.trimmedTerm) &&
    !isScannerSearchEmailLike(args.trimmedTerm) &&
    args.resultsAreCurrent &&
    args.resultCount === 0
  );
}

/**
 * Whether to show a neutral loading state instead of result rows — the panel
 * is open but the query results do not yet correspond to the visible term
 * (typing debounce not fired, or a query for the new term/organizer is
 * in-flight and `.data()` still holds the previous payload).
 */
export function shouldShowScannerSearchLoading(args: {
  trimmedTerm: string;
  resultsAreCurrent: boolean;
}): boolean {
  return (
    shouldShowScannerSearchPanel(args.trimmedTerm) && !args.resultsAreCurrent
  );
}

/** Status label for a search result row, based on existing admin/scanner sets. */
export function getScannerResultStatus<TUserId>(
  userId: TUserId,
  adminUserIds: ReadonlySet<TUserId>,
  scannerUserIds: ReadonlySet<TUserId>,
): ScannerResultStatus {
  if (adminUserIds.has(userId)) return 'admin';
  if (scannerUserIds.has(userId)) return 'added';
  return null;
}

/** Next active index for ArrowDown, wrapping to the first option. */
export function nextScannerSearchActiveIndex(
  currentIndex: number,
  optionCount: number,
): number {
  if (optionCount === 0) return currentIndex;
  return (currentIndex + 1) % optionCount;
}

/** Previous active index for ArrowUp, wrapping to the last option. */
export function previousScannerSearchActiveIndex(
  currentIndex: number,
  optionCount: number,
): number {
  if (optionCount === 0) return currentIndex;
  return currentIndex <= 0 ? optionCount - 1 : currentIndex - 1;
}

/**
 * A `setTimeout`-based debounce timer, matching the pattern in
 * `members-table.component.ts` (immediate signal → debounced signal). Kept
 * as a plain class (no Angular deps) so components only own the signals.
 */
export class DebounceTimer {
  private handle: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly delayMs: number) {}

  /** Cancels any pending call and schedules a new one. */
  schedule(fn: () => void): void {
    this.cancel();
    this.handle = setTimeout(fn, this.delayMs);
  }

  cancel(): void {
    if (this.handle) {
      clearTimeout(this.handle);
      this.handle = null;
    }
  }
}

/**
 * Owns the pure UI state for the door staff member search combobox —
 * keyboard-nav index and the derived panel/fallback/empty-state predicates.
 * Signal-based but Angular-DI-free so it can be constructed directly by the
 * component (kept out of the component class body to stay under the repo's
 * max-lines budget).
 *
 * The immediate/debounced search signals and the query itself stay in the
 * component: `injectQuery`'s args function closes over the debounced term,
 * and this class's `results`/`resultsAreCurrent` close over the query —
 * declaring both inside one constructor call creates a circular type-inference
 * error, so the search/debounce signals are passed in already-constructed
 * instead of being owned here.
 */
export class ScannerSearchState<TCandidate, TUserId> {
  readonly activeIndex = signal(-1);
  readonly trimmedSearch = computed(() => this.deps.searchInput().trim());

  constructor(
    private readonly deps: {
      searchInput: WritableSignal<string>;
      debouncedTerm: WritableSignal<string>;
      debounce: DebounceTimer;
      results: Signal<TCandidate[]>;
      /**
       * True only when `results` correspond to the currently-visible term AND
       * the currently-selected organizer. `injectQuery` retains the previous
       * `.data()` across an args change ("preserve existing data during
       * refetch"), so this MUST be checked before rendering or granting a row
       * — otherwise a stale row can grant the wrong user (see grant guard).
       */
      resultsAreCurrent: Signal<boolean>;
      resultUserId: (candidate: TCandidate) => TUserId;
      adminUserIds: Signal<ReadonlySet<TUserId>>;
      scannerUserIds: Signal<ReadonlySet<TUserId>>;
    },
  ) {}

  get search(): Signal<string> {
    return this.deps.searchInput;
  }

  /**
   * Result rows to render: the query payload when it is current, else `[]`.
   * Empty while stale/in-flight so no stale row can be rendered or clicked.
   */
  readonly results = computed<TCandidate[]>(() =>
    this.deps.resultsAreCurrent() ? this.deps.results() : [],
  );

  optionId(index: number): string {
    return scannerSearchOptionId(index);
  }

  readonly showPanel = computed(() =>
    shouldShowScannerSearchPanel(this.trimmedSearch()),
  );
  readonly showLoading = computed(() =>
    shouldShowScannerSearchLoading({
      trimmedTerm: this.trimmedSearch(),
      resultsAreCurrent: this.deps.resultsAreCurrent(),
    }),
  );
  readonly showEmailFallback = computed(() =>
    shouldShowScannerEmailFallback({
      trimmedTerm: this.trimmedSearch(),
      resultsAreCurrent: this.deps.resultsAreCurrent(),
      resultCount: this.deps.results().length,
    }),
  );
  readonly showEmptyState = computed(() =>
    shouldShowScannerSearchEmptyState({
      trimmedTerm: this.trimmedSearch(),
      resultsAreCurrent: this.deps.resultsAreCurrent(),
      resultCount: this.deps.results().length,
    }),
  );
  readonly activeDescendant = computed<string | null>(() => {
    const idx = this.activeIndex();
    return idx >= 0 ? scannerSearchOptionId(idx) : null;
  });

  resultStatus(userId: TUserId): ScannerResultStatus {
    return getScannerResultStatus(
      userId,
      this.deps.adminUserIds(),
      this.deps.scannerUserIds(),
    );
  }

  isResultDisabled(candidate: TCandidate): boolean {
    return this.resultStatus(this.deps.resultUserId(candidate)) !== null;
  }

  /**
   * Path-independent hard guard for the grant action: a row is grantable only
   * when results are current (right term + right organizer) and the row is not
   * already an admin/existing scanner. Defends the click path regardless of
   * what happens to be rendered.
   */
  canGrantResult(candidate: TCandidate): boolean {
    return this.deps.resultsAreCurrent() && !this.isResultDisabled(candidate);
  }

  onInput(value: string): void {
    this.deps.searchInput.set(value);
    this.activeIndex.set(-1);
    const trimmed = value.trim();
    this.deps.debounce.schedule(() => this.deps.debouncedTerm.set(trimmed));
  }

  clear(): void {
    this.deps.debounce.cancel();
    this.deps.searchInput.set('');
    this.deps.debouncedTerm.set('');
    this.activeIndex.set(-1);
  }

  /** Moves the active index forward. Returns false (no-op) when there are no results. */
  onArrowDown(): boolean {
    const count = this.results().length;
    if (count === 0) return false;
    this.activeIndex.update((i) => nextScannerSearchActiveIndex(i, count));
    return true;
  }

  /** Moves the active index backward. Returns false (no-op) when there are no results. */
  onArrowUp(): boolean {
    const count = this.results().length;
    if (count === 0) return false;
    this.activeIndex.update((i) => previousScannerSearchActiveIndex(i, count));
    return true;
  }

  /** Returns the row to grant on Enter: an in-range active result, or 'email-fallback'. */
  onEnter(): TCandidate | 'email-fallback' | null {
    const index = this.activeIndex();
    const results = this.results();
    if (index >= 0 && index < results.length) return results[index];
    if (this.showEmailFallback()) return 'email-fallback';
    return null;
  }
}

export function scannerSearchOptionId(index: number): string {
  return `scanner-search-option-${index}`;
}
