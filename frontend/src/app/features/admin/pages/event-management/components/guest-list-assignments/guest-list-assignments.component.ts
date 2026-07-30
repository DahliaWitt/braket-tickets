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
import type {CommunityMemberCandidate} from './guest-list-organizer.service';
import {ConfirmationFocusManager} from './confirmation-focus-manager';
import {
  EMPTY_OVERVIEW,
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
  readonly overview = input<GuestListEventOverview>(EMPTY_OVERVIEW);
  readonly assignments = input<readonly GuestListAssignment[]>([]);
  readonly continueCursor = input<string | null>(null);
  private readonly loadedContinueCursor = signal<string | null | undefined>(
    undefined,
  );
  readonly effectiveContinueCursor = computed(() => {
    const loaded = this.loadedContinueCursor();
    return loaded === undefined ? this.continueCursor() : loaded;
  });
  private readonly grantWarning = viewChild<
    unknown,
    ElementRef<HTMLElement>
  >('grantWarning', {read: ElementRef});
  private readonly revokeWarning = viewChild<
    unknown,
    ElementRef<HTMLElement>
  >('revokeWarning', {read: ElementRef});
  private readonly confirmationFocus = new ConfirmationFocusManager();
  readonly pendingRevoke = signal<GuestListAssignment | null>(null);
  readonly pendingGrantReduction = signal<{
    assignmentId: string;
    grant: number;
  } | null>(null);
  readonly editingGrantId = signal<string | null>(null);
  readonly grantEditValue = signal('');
  readonly expandedAssignmentId = signal<string | null>(null);
  private readonly expandedGuestPages = signal<
    ReadonlyMap<string, SourcedGuestPage>
  >(new Map());
  private readonly expandedGuestUsage = signal<ReadonlyMap<string, number>>(
    new Map(),
  );
  private readonly expandedGuestAttemptedUsage = signal<
    ReadonlyMap<string, number>
  >(new Map());
  private readonly failedGuestLoads = signal<ReadonlySet<string>>(new Set());
  readonly memberResults = signal<readonly CommunityMemberCandidate[]>([]);
  readonly selectedMember = signal<CommunityMemberCandidate | null>(null);
  readonly selectedUserId = computed(() => this.selectedMember()?.userId);
  readonly additionalAssignments = signal<readonly GuestListAssignment[]>([]);
  readonly visibleAssignments = computed(() => {
    const byId = new Map<string, GuestListAssignment>();
    for (const assignment of [
      ...this.assignments(),
      ...this.additionalAssignments(),
    ]) {
      byId.set(assignment.assignmentId, assignment);
    }
    return [...byId.values()];
  });
  readonly isCreating = signal(false);
  readonly isSearching = signal(false);
  readonly isBulkCreating = signal(false);
  readonly updatingGrantId = signal<string | null>(null);
  readonly loadingGuestsId = signal<string | null>(null);
  readonly isLoadingMoreAssignments = signal(false);
  readonly revokingId = signal<string | null>(null);
  readonly resendingId = signal<string | null>(null);
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
      const selected = this.selectedMember();
      const emailAddress = this.assignmentModel().email.trim().toLowerCase();
      const selectedEmail = selected?.email?.trim().toLowerCase() ?? '';
      if (selected && selectedEmail !== emailAddress) {
        this.selectedMember.set(null);
      }
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
        void this.fetchGuests(assignmentId, null);
      }
    });
  }

  async searchMembers(): Promise<void> {
    const term = this.assignmentModel().search.trim();
    if (!term || !this.organizerId() || this.isSearching()) return;
    this.actionError.set(null);
    this.isSearching.set(true);
    try {
      this.memberResults.set(
        await this.service.searchMembers(this.organizerId(), term),
      );
    } catch (error) {
      logger.error('Failed to search guest list assignees', error);
      this.actionError.set("couldn't search community members — try again?");
    } finally {
      this.isSearching.set(false);
    }
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

  async createAssignment(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.assignmentSubmitted.set(true);
    const eventId = this.eventId();
    if (this.assignmentForm().invalid() || !eventId || this.isCreating())
      return;
    const value = this.assignmentModel();
    const override = value.grantOverride.trim();
    this.isCreating.set(true);
    this.actionError.set(null);
    try {
      await this.service.create({
        eventId,
        role: value.role,
        displayName: value.displayName.trim(),
        email: value.email.trim(),
        userId: this.selectedUserId(),
        grantedSlots: override ? Number(override) : undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      toast.success('Guest list invite queued');
      this.assignmentModel.set({
        search: '',
        displayName: '',
        email: '',
        role: 'artist',
        grantOverride: '',
      });
      this.selectedMember.set(null);
      this.assignmentSubmitted.set(false);
    } catch (error) {
      logger.error('Failed to create guest list assignment', error);
      toast.error('Failed to send guest list invite');
      this.actionError.set("couldn't send this invite — try again?");
    } finally {
      this.isCreating.set(false);
    }
  }

  markAssignmentSubmitted(): void {
    this.assignmentSubmitted.set(true);
  }

  async bulkCreateStaff(payload: ImportConfirmPayload): Promise<void> {
    if (this.isBulkCreating()) return;
    this.actionError.set(null);
    this.isBulkCreating.set(true);
    try {
      const result = await this.service.bulkCreateStaff(
        this.eventId(),
        payload.batchKey,
        payload.rows.map((row) => ({
          name: row.name,
          email: row.email ?? '',
          slotOverride: row.slotOverride,
        })),
      );
      this.importReport.set(buildImportReport(result));
    } catch (error) {
      logger.error('Failed to import staff assignments', error);
      this.importReport.set(
        buildImportErrorReport(error, 'Could not import staff — try again?'),
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
    if (this.updatingGrantId()) return;
    const grant = Number(this.grantEditValue());
    if (!Number.isInteger(grant) || grant < 0 || grant > 100) return;
    this.confirmationFocus.remember(event);
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
    assignmentId: string,
    grant: number,
  ): Promise<boolean> {
    if (this.updatingGrantId()) return false;
    this.actionError.set(null);
    this.updatingGrantId.set(assignmentId);
    try {
      await this.service.updateGrant(assignmentId, grant);
      this.editingGrantId.set(null);
      toast.success('Guest list grant updated');
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
    await this.fetchGuests(assignment.assignmentId, null);
  }

  guestsFor(assignmentId: string): readonly SourcedGuest[] {
    return this.expandedGuestPages().get(assignmentId)?.guests ?? [];
  }

  guestContinueCursor(assignmentId: string): string | null {
    return this.expandedGuestPages().get(assignmentId)?.continueCursor ?? null;
  }

  guestLoadFailed(assignmentId: string): boolean {
    return this.failedGuestLoads().has(assignmentId);
  }

  async retryGuests(assignmentId: string): Promise<void> {
    if (this.loadingGuestsId()) return;
    await this.fetchGuests(assignmentId, null);
  }

  async loadMoreGuests(assignmentId: string): Promise<void> {
    const cursor = this.guestContinueCursor(assignmentId);
    if (!cursor || this.loadingGuestsId()) return;
    await this.fetchGuests(assignmentId, cursor);
  }

  private async fetchGuests(
    assignmentId: string,
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
      const result = await this.service.listGuests(assignmentId, cursor);
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
      if (shouldRefetch) void this.fetchGuests(assignmentId, null);
    }
  }

  async loadMoreAssignments(): Promise<void> {
    const cursor = this.effectiveContinueCursor();
    if (!cursor || !this.eventId() || this.isLoadingMoreAssignments()) return;
    const requestGeneration = this.assignmentPageGeneration;
    const eventId = this.eventId();
    this.actionError.set(null);
    this.isLoadingMoreAssignments.set(true);
    try {
      const result = await this.service.listByEvent(eventId, cursor);
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
      await this.service.revoke(assignment.assignmentId);
      this.pendingRevoke.set(null);
      this.confirmationFocus.restore(true);
      toast.success('Guest list access revoked');
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
    try {
      await this.service.resendInvite(
        assignment.assignmentId,
        crypto.randomUUID(),
      );
      toast.success('Invite queued');
    } catch (error) {
      logger.error('Failed to resend guest list invite', error);
      this.actionError.set("couldn't resend this invite — try again?");
    } finally {
      this.resendingId.set(null);
    }
  }
}
