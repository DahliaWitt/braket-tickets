import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  email,
  FormField,
  form,
  required,
  validate,
} from '@angular/forms/signals';
import type {Id} from '@convex/_generated/dataModel';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {BraStatusBadgeComponent} from '@ui/components/primitives/status-badge/status-badge.component';
import {ImportSurfaceComponent} from '@/features/admin/import/import-surface.component';
import {ASSIGNMENT_STAFF_IMPORT_CONFIG} from '@/features/admin/import/import-config';
import type {
  ImportConfirmPayload,
  ImportReport,
} from '@/features/admin/import/import-surface.types';
import {buildImportErrorReport, buildImportReport} from '../import-report.util';
import {GuestListOrganizerService} from './guest-list-organizer.service';
import type {
  BulkCreateStaffArgs,
  CommunityMemberCandidate,
} from './guest-list-organizer.service';
import {ConfirmationFocusManager} from './confirmation-focus-manager';
import {
  type AssignmentFormValue,
  type GuestListAssignment,
  type GuestListEventOverview,
  type SourcedGuest,
  type SourcedGuestPage,
} from './guest-list-assignments.models';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {signalFormFieldErrorMessage} from '@/utils/signal-form';

export type {GuestListAssignment, GuestListEventOverview};

type GuestListAssignmentId = GuestListAssignment['assignmentId'];
/** Wire shape for one bulk staff-import row, pulled from the generated API. */
type StaffImportRow = BulkCreateStaffArgs['rows'][number];

@Component({
  selector: 'app-guest-list-assignments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    ZardButtonComponent,
    ZardInputDirective,
    BraStatusBadgeComponent,
    ImportSurfaceComponent,
  ],
  templateUrl: './guest-list-assignments.component.html',
})
export class GuestListAssignmentsComponent {
  private readonly service = inject(GuestListOrganizerService);
  readonly eventId = input<Id<'events'> | ''>('');
  readonly organizerId = input<Id<'organizers'> | ''>('');
  /**
   * `null` while the organizer overview query is still unresolved. Rendering
   * zeros before the totals land makes a busy event look empty, so the template
   * shows a loading state instead of fabricated counts.
   */
  readonly overview = input<GuestListEventOverview | null>(null);
  readonly assignments = input<readonly GuestListAssignment[]>([]);
  readonly continueCursor = input<string | null>(null);
  private readonly loadedContinueCursor = signal<string | null | undefined>(
    undefined,
  );
  readonly effectiveContinueCursor = computed(() => {
    const loaded = this.loadedContinueCursor();
    return loaded === undefined ? this.continueCursor() : loaded;
  });
  private readonly grantWarning = viewChild<unknown, ElementRef<HTMLElement>>(
    'grantWarning',
    {read: ElementRef},
  );
  private readonly revokeWarning = viewChild<unknown, ElementRef<HTMLElement>>(
    'revokeWarning',
    {read: ElementRef},
  );
  private readonly confirmationFocus = new ConfirmationFocusManager();
  readonly pendingRevoke = signal<GuestListAssignment | null>(null);
  readonly pendingGrantReduction = signal<{
    assignmentId: GuestListAssignmentId;
    grant: number;
  } | null>(null);
  readonly editingGrantId = signal<GuestListAssignmentId | null>(null);
  readonly grantEditValue = signal('');
  readonly expandedAssignmentId = signal<GuestListAssignmentId | null>(null);
  private readonly expandedGuestPages = signal<
    ReadonlyMap<string, SourcedGuestPage>
  >(new Map());
  private readonly expandedGuestUsage = signal<ReadonlyMap<string, number>>(
    new Map(),
  );
  private readonly expandedGuestAttemptedUsage = signal<
    ReadonlyMap<string, number>
  >(new Map());
  private queuedGuestLoad: {
    assignmentId: GuestListAssignmentId;
    cursor: string | null;
  } | null = null;
  private readonly failedGuestLoads = signal<ReadonlySet<string>>(new Set());
  readonly memberResults = signal<readonly CommunityMemberCandidate[]>([]);
  readonly selectedMember = signal<CommunityMemberCandidate | null>(null);
  readonly selectedUserId = computed(() => this.selectedMember()?.userId);
  readonly additionalAssignments = signal<readonly GuestListAssignment[]>([]);
  readonly visibleAssignments = computed(() => {
    // The first page is the live subscription; later pages are point-in-time
    // snapshots. The reactive copy of an assignment always wins over a stale
    // snapshot of the same ID, and first-page rows keep rendering first.
    const byId = new Map<string, GuestListAssignment>();
    for (const assignment of this.assignments()) {
      byId.set(assignment.assignmentId, assignment);
    }
    for (const assignment of this.additionalAssignments()) {
      if (byId.has(assignment.assignmentId)) continue;
      byId.set(assignment.assignmentId, assignment);
    }
    return [...byId.values()];
  });
  readonly isCreating = signal(false);
  readonly isSearching = signal(false);
  readonly isBulkCreating = signal(false);
  readonly updatingGrantId = signal<GuestListAssignmentId | null>(null);
  readonly loadingGuestsId = signal<GuestListAssignmentId | null>(null);
  readonly isLoadingMoreAssignments = signal(false);
  readonly revokingId = signal<GuestListAssignmentId | null>(null);
  readonly resendingId = signal<GuestListAssignmentId | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly isImporting = signal(false);
  readonly importReport = signal<ImportReport | null>(null);
  readonly staffImportConfig = ASSIGNMENT_STAFF_IMPORT_CONFIG;
  protected readonly assignmentModel = signal<AssignmentFormValue>({
    search: '',
    displayName: '',
    email: '',
    role: 'artist',
    grantOverride: '',
  });
  readonly assignmentForm = form(this.assignmentModel, (fields) => {
    required(fields.displayName, {message: 'Name is required'});
    required(fields.email, {message: 'Email is required'});
    email(fields.email, {message: 'Enter a valid email'});
    validate(fields.grantOverride, ({value}) => {
      const raw = value().trim();
      if (!raw) return undefined;
      const parsed = Number(raw);
      return /^\d+$/.test(raw) && Number.isInteger(parsed) && parsed <= 100
        ? undefined
        : {
            kind: 'slots',
            message: 'Use a whole number between 0 and 100',
          };
    });
  });
  readonly assignmentSubmitted = signal(false);
  /**
   * Idempotency key for the invite currently being submitted, bound to the
   * exact payload it was minted for. A retry of the same invite after a
   * commit-then-disconnect (the mutation lands but the response is lost) must
   * replay as the same operation, or the server creates a second assignment,
   * credential, and invite email. Editing the recipient first makes it a
   * different operation, so the key rotates. Cleared on a confirmed success.
   */
  private pendingCreate: {signature: string; key: string} | null = null;
  /** Same replay protection, keyed per assignment, for invite resends. */
  private readonly resendIdempotencyKeys = new Map<
    GuestListAssignmentId,
    string
  >();

  /**
   * Validation for the inline grant editor. Mirrors the invite slot-override
   * field: digits only (so `''`, `1e2`, `0x10`, and `1.5` are all rejected)
   * within 0..100.
   */
  readonly grantEditError = computed<string | null>(() => {
    const raw = this.grantEditValue().trim();
    const parsed = Number(raw);
    return /^\d+$/.test(raw) && Number.isInteger(parsed) && parsed <= 100
      ? null
      : 'Use a whole number between 0 and 100';
  });

  protected assignmentNameError(): string | null {
    if (
      !this.assignmentSubmitted() &&
      !this.assignmentForm.displayName().touched()
    )
      return null;
    return signalFormFieldErrorMessage(this.assignmentForm.displayName, [
      'required',
    ]);
  }

  protected assignmentEmailError(): string | null {
    if (!this.assignmentSubmitted() && !this.assignmentForm.email().touched())
      return null;
    return signalFormFieldErrorMessage(this.assignmentForm.email, [
      'required',
      'email',
    ]);
  }

  private firstPageBoundary: string | undefined;
  private assignmentPageGeneration = 0;

  constructor() {
    effect(() => {
      (this.grantWarning() ?? this.revokeWarning())?.nativeElement.focus();
    });
    effect(() => {
      const boundary = `${this.continueCursor() ?? ''}:${this.assignments()
        .map((assignment) => assignment.assignmentId)
        .join(',')}`;
      if (this.firstPageBoundary === undefined) {
        this.firstPageBoundary = boundary;
        return;
      }
      if (this.firstPageBoundary === boundary) return;
      this.firstPageBoundary = boundary;
      this.assignmentPageGeneration += 1;
      untracked(() => {
        this.additionalAssignments.set([]);
        this.loadedContinueCursor.set(undefined);
        this.isLoadingMoreAssignments.set(false);
      });
    });
    effect(() => {
      const assignmentId = this.expandedAssignmentId();
      if (!assignmentId || !this.expandedGuestPages().has(assignmentId)) return;
      const assignment = this.visibleAssignments().find(
        (candidate) => candidate.assignmentId === assignmentId,
      );
      if (!assignment) return;
      const lastUsage = this.expandedGuestUsage().get(assignmentId);
      const attemptedUsage =
        this.expandedGuestAttemptedUsage().get(assignmentId);
      if (
        lastUsage !== undefined &&
        lastUsage !== assignment.usedSlots &&
        attemptedUsage !== assignment.usedSlots &&
        this.loadingGuestsId() !== assignmentId
      ) {
        // `fetchGuests` reads and writes loading/usage state synchronously
        // before its first await. Running it untracked keeps those reads out of
        // this effect's dependency set, so termination does not rely on the
        // attempted-usage guard alone.
        untracked(() => void this.fetchGuests(assignmentId, null));
      }
    });
  }

  async searchMembers(): Promise<void> {
    const term = this.assignmentModel().search.trim();
    const organizerId = this.organizerId();
    if (!term || !organizerId || this.isSearching()) return;
    this.actionError.set(null);
    this.isSearching.set(true);
    try {
      this.memberResults.set(
        await this.service.searchMembers({
          organizerId,
          searchTerm: term,
        }),
      );
    } catch (error) {
      logger.error('Failed to search guest list assignees', error);
      this.actionError.set("couldn't search community members — try again?");
    } finally {
      this.isSearching.set(false);
    }
  }

  searchMembersFromKeyboard(event: Event): void {
    if (!(event instanceof KeyboardEvent)) return;
    event.preventDefault();
    if (event.isComposing) return;
    void this.searchMembers();
  }

  selectMember(member: CommunityMemberCandidate): void {
    this.assignmentModel.update((value) => ({
      ...value,
      displayName: member.displayName,
      email: member.email ?? '',
    }));
    this.selectedMember.set(member);
    this.memberResults.set([]);
  }

  clearSelectedMember(): void {
    this.selectedMember.set(null);
  }

  onAssignmentEmailInput(event: Event): void {
    const input = event.target;
    const selected = this.selectedMember();
    if (!(input instanceof HTMLInputElement) || !selected) return;
    const selectedEmail = selected.email?.trim().toLowerCase() ?? '';
    if (input.value.trim().toLowerCase() !== selectedEmail) {
      this.selectedMember.set(null);
    }
  }

  async createAssignment(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.assignmentSubmitted.set(true);
    const eventId = this.eventId();
    if (this.assignmentForm().invalid() || !eventId || this.isCreating())
      return;
    const value = this.assignmentModel();
    const override = value.grantOverride.trim();
    const displayName = value.displayName.trim();
    const email = value.email.trim();
    const userId = this.selectedUserId();
    this.isCreating.set(true);
    this.actionError.set(null);
    try {
      await this.service.create({
        eventId,
        role: value.role,
        displayName,
        email,
        userId,
        grantedSlots: override ? Number(override) : undefined,
        idempotencyKey: this.createKeyFor(
          JSON.stringify([
            eventId,
            value.role,
            displayName,
            email,
            userId,
            override,
          ]),
        ),
      });
      this.pendingCreate = null;
      toast.success('guest list invite queued');
      this.assignmentModel.set({
        search: '',
        displayName: '',
        email: '',
        role: 'artist',
        grantOverride: '',
      });
      this.assignmentForm().reset();
      this.selectedMember.set(null);
      this.assignmentSubmitted.set(false);
    } catch (error) {
      logger.error('Failed to create guest list assignment', error);
      toast.error('failed to send guest list invite');
      this.actionError.set("couldn't send this invite — try again?");
    } finally {
      this.isCreating.set(false);
    }
  }

  /**
   * The idempotency key for this exact invite payload — reused while the
   * payload is unchanged (retry of the same operation), rotated when it
   * changes (a new operation).
   */
  private createKeyFor(signature: string): string {
    if (this.pendingCreate?.signature !== signature) {
      this.pendingCreate = {signature, key: crypto.randomUUID()};
    }
    return this.pendingCreate.key;
  }

  markAssignmentSubmitted(): void {
    this.assignmentSubmitted.set(true);
  }

  async bulkCreateStaff(payload: ImportConfirmPayload): Promise<void> {
    const eventId = this.eventId();
    if (!eventId || this.isBulkCreating()) return;
    this.actionError.set(null);
    // `ASSIGNMENT_STAFF_IMPORT_CONFIG.validateRow` runs `validateRequiredEmail`,
    // so every confirmed row already carries an email. Narrow rather than
    // defaulting to `''`: an empty address would be a contract break the server
    // rejects row-by-row, and silently sending it would hide the regression.
    const rows: StaffImportRow[] = [];
    for (const row of payload.rows) {
      if (!row.email) {
        logger.error(
          'Staff import confirmed a row without an email — refusing to import',
        );
        this.importReport.set(
          buildImportErrorReport(
            new Error('Staff import row is missing an email'),
            'could not import staff — try again?',
          ),
        );
        this.actionError.set("couldn't import staff — try again?");
        return;
      }
      rows.push({
        name: row.name,
        email: row.email,
        slotOverride: row.slotOverride,
      });
    }
    this.isBulkCreating.set(true);
    try {
      const result = await this.service.bulkCreateStaff({
        eventId,
        batchKey: payload.batchKey,
        rows,
      });
      this.importReport.set(buildImportReport(result));
    } catch (error) {
      logger.error('Failed to import staff assignments', error);
      this.importReport.set(
        buildImportErrorReport(error, 'could not import staff — try again?'),
      );
      this.actionError.set("couldn't import staff — try again?");
    } finally {
      this.isBulkCreating.set(false);
    }
  }

  beginGrantEdit(assignment: GuestListAssignment): void {
    this.editingGrantId.set(assignment.assignmentId);
    this.grantEditValue.set(String(assignment.grantedSlots));
  }

  onGrantValueInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement)
      this.grantEditValue.set(target.value);
  }

  onRoleChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const role = target.value;
    if (role === 'artist' || role === 'staff') {
      this.assignmentModel.update((value) => ({...value, role}));
    }
  }

  async saveGrant(
    assignment: GuestListAssignment,
    event?: Event,
  ): Promise<void> {
    if (this.updatingGrantId() || this.grantEditError()) return;
    const grant = Number(this.grantEditValue().trim());
    this.confirmationFocus.remember(event);
    this.pendingRevoke.set(null);
    if (grant < assignment.usedSlots) {
      this.pendingGrantReduction.set({
        assignmentId: assignment.assignmentId,
        grant,
      });
      return;
    }
    if (await this.persistGrant(assignment.assignmentId, grant)) {
      this.confirmationFocus.restore(true);
    }
  }

  async confirmGrantReduction(): Promise<void> {
    const pending = this.pendingGrantReduction();
    if (!pending) return;
    if (await this.persistGrant(pending.assignmentId, pending.grant)) {
      this.pendingGrantReduction.set(null);
      this.confirmationFocus.restore(true);
    }
  }

  cancelGrantReduction(): void {
    if (this.updatingGrantId()) return;
    this.pendingGrantReduction.set(null);
    this.confirmationFocus.restore();
  }

  handleGrantWarningKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.cancelGrantReduction();
  }

  private async persistGrant(
    assignmentId: GuestListAssignmentId,
    grant: number,
  ): Promise<boolean> {
    if (this.updatingGrantId()) return false;
    this.actionError.set(null);
    this.updatingGrantId.set(assignmentId);
    try {
      await this.service.updateGrant({
        assignmentId,
        grantedSlots: grant,
      });
      this.editingGrantId.set(null);
      toast.success('guest list grant updated');
      return true;
    } catch (error) {
      logger.error('Failed to update guest list grant', error);
      this.actionError.set("couldn't update this grant — try again?");
      return false;
    } finally {
      this.updatingGrantId.set(null);
    }
  }

  async toggleGuests(assignment: GuestListAssignment): Promise<void> {
    if (this.loadingGuestsId() === assignment.assignmentId) return;
    if (this.expandedAssignmentId() === assignment.assignmentId) {
      this.expandedAssignmentId.set(null);
      return;
    }
    this.expandedAssignmentId.set(assignment.assignmentId);
    if (this.expandedGuestPages().has(assignment.assignmentId)) return;
    if (this.loadingGuestsId()) {
      this.queuedGuestLoad = {
        assignmentId: assignment.assignmentId,
        cursor: null,
      };
      return;
    }
    await this.fetchGuests(assignment.assignmentId, null);
  }

  guestsFor(assignmentId: GuestListAssignmentId): readonly SourcedGuest[] {
    return this.expandedGuestPages().get(assignmentId)?.guests ?? [];
  }

  guestContinueCursor(assignmentId: GuestListAssignmentId): string | null {
    return this.expandedGuestPages().get(assignmentId)?.continueCursor ?? null;
  }

  guestLoadFailed(assignmentId: GuestListAssignmentId): boolean {
    return this.failedGuestLoads().has(assignmentId);
  }

  async retryGuests(assignmentId: GuestListAssignmentId): Promise<void> {
    if (this.loadingGuestsId()) return;
    await this.fetchGuests(assignmentId, null);
  }

  async loadMoreGuests(assignmentId: GuestListAssignmentId): Promise<void> {
    const cursor = this.guestContinueCursor(assignmentId);
    if (!cursor || this.loadingGuestsId()) return;
    await this.fetchGuests(assignmentId, cursor);
  }

  private async fetchGuests(
    assignmentId: GuestListAssignmentId,
    cursor: string | null,
  ): Promise<void> {
    if (this.loadingGuestsId()) return;
    const usageAtStart = this.visibleAssignments().find(
      (assignment) => assignment.assignmentId === assignmentId,
    )?.usedSlots;
    let shouldRefetch = false;
    if (usageAtStart !== undefined) {
      this.expandedGuestAttemptedUsage.update((current) =>
        new Map(current).set(assignmentId, usageAtStart),
      );
    }
    this.failedGuestLoads.update((current) => {
      const next = new Set(current);
      next.delete(assignmentId);
      return next;
    });
    this.actionError.set(null);
    this.loadingGuestsId.set(assignmentId);
    try {
      const result = await this.service.listGuests({
        assignmentId,
        paginationOpts: {numItems: 25, cursor},
      });
      const currentUsage = this.visibleAssignments().find(
        (assignment) => assignment.assignmentId === assignmentId,
      )?.usedSlots;
      if (currentUsage !== usageAtStart) {
        shouldRefetch = this.expandedAssignmentId() === assignmentId;
        return;
      }
      if (currentUsage !== undefined) {
        this.expandedGuestUsage.update((current) =>
          new Map(current).set(assignmentId, currentUsage),
        );
      }
      this.expandedGuestPages.update((current) => {
        const previous = current.get(assignmentId)?.guests ?? [];
        return new Map(current).set(assignmentId, {
          guests: cursor ? [...previous, ...result.page] : result.page,
          continueCursor: result.isDone ? null : result.continueCursor,
        });
      });
    } catch (error) {
      this.failedGuestLoads.update((current) =>
        new Set(current).add(assignmentId),
      );
      logger.error('Failed to load assignment guests', error);
      this.actionError.set("couldn't load this guest list — try again?");
    } finally {
      this.loadingGuestsId.set(null);
      const queued = this.queuedGuestLoad;
      this.queuedGuestLoad = null;
      if (shouldRefetch) {
        void this.fetchGuests(assignmentId, null);
      } else if (
        queued &&
        this.expandedAssignmentId() === queued.assignmentId
      ) {
        void this.fetchGuests(queued.assignmentId, queued.cursor);
      }
    }
  }

  async loadMoreAssignments(): Promise<void> {
    const cursor = this.effectiveContinueCursor();
    const eventId = this.eventId();
    if (!cursor || !eventId || this.isLoadingMoreAssignments()) return;
    const requestGeneration = this.assignmentPageGeneration;
    this.actionError.set(null);
    this.isLoadingMoreAssignments.set(true);
    try {
      const result = await this.service.listByEvent({
        eventId,
        paginationOpts: {numItems: 25, cursor},
      });
      if (requestGeneration !== this.assignmentPageGeneration) return;
      this.additionalAssignments.update((current) => [
        ...current,
        ...result.page,
      ]);
      this.loadedContinueCursor.set(
        result.isDone ? null : result.continueCursor,
      );
    } catch (error) {
      if (requestGeneration !== this.assignmentPageGeneration) return;
      logger.error('Failed to load more guest list assignments', error);
      this.actionError.set("couldn't load more assignments — try again?");
    } finally {
      if (requestGeneration === this.assignmentPageGeneration) {
        this.isLoadingMoreAssignments.set(false);
      }
    }
  }

  beginRevoke(assignment: GuestListAssignment, event: Event): void {
    this.confirmationFocus.remember(event);
    this.pendingGrantReduction.set(null);
    this.pendingRevoke.set(assignment);
  }

  cancelRevoke(): void {
    if (this.revokingId()) return;
    this.pendingRevoke.set(null);
    this.confirmationFocus.restore();
  }

  handleRevokeWarningKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.cancelRevoke();
  }

  async confirmRevoke(assignment: GuestListAssignment): Promise<void> {
    if (this.revokingId()) return;
    this.actionError.set(null);
    this.revokingId.set(assignment.assignmentId);
    try {
      await this.service.revoke({assignmentId: assignment.assignmentId});
      this.pendingRevoke.set(null);
      this.confirmationFocus.restore(true);
      toast.success('guest list access revoked');
    } catch (error) {
      logger.error('Failed to revoke guest list assignment', error);
      this.actionError.set("couldn't revoke this assignment — try again?");
    } finally {
      this.revokingId.set(null);
    }
  }

  async resendInvite(assignment: GuestListAssignment): Promise<void> {
    if (this.resendingId()) return;
    this.actionError.set(null);
    this.resendingId.set(assignment.assignmentId);
    const assignmentId = assignment.assignmentId;
    let idempotencyKey = this.resendIdempotencyKeys.get(assignmentId);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      this.resendIdempotencyKeys.set(assignmentId, idempotencyKey);
    }
    try {
      await this.service.resendInvite({assignmentId, idempotencyKey});
      this.resendIdempotencyKeys.delete(assignmentId);
      toast.success('invite queued');
    } catch (error) {
      logger.error('Failed to resend guest list invite', error);
      this.actionError.set("couldn't resend this invite — try again?");
    } finally {
      this.resendingId.set(null);
    }
  }
}
