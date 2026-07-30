import {DatePipe} from '@angular/common';
import {
  Component,
  inject,
  input,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {AuthService} from '@/core/services/auth.service';
import {injectQuery} from 'convex-angular';
import {type Application} from '@/features/vetting/models/application.model';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {BraStatusBadgeComponent} from '@ui/components/primitives/status-badge/status-badge.component';
import {type BraStatusBadgeVariants} from '@ui/components/primitives/status-badge/status-badge.variants';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {ReasonDialogComponent} from '@/features/admin/components/reason-dialog/reason-dialog.component';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {ADMIN_DATETIME} from '@/features/admin/utils/date-formats';

interface VettingAnswer {
  label: string;
  value: unknown;
}

type ApplicationRowAction = 'approved' | 'rejected' | 'reinstate';

type StatusBadgeVariant = NonNullable<BraStatusBadgeVariants['status']>;

const STATUS_BADGE_VARIANTS: Record<string, StatusBadgeVariant> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'destructive',
  revoked: 'muted',
};

@Component({
  selector: 'app-admin-applications-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ZardButtonComponent,
    ZardInputDirective,
    ZardSkeletonComponent,
    EmptyStateComponent,
    BraStatusBadgeComponent,
  ],
  templateUrl: './applications-table.component.html',
})
export class AdminApplicationsTableComponent {
  private appsService = inject(ApplicationsService);
  private auth = inject(AuthService);
  private dialog = inject(BraDialogService);

  // Inputs
  readonly tableType = input<'pending' | 'history'>('pending');
  readonly organizerId = input<Id<'organizers'> | undefined>(undefined);

  // State
  private readonly applicationsQuery = injectQuery(
    api.communities.applications.list,
    () => {
      const base =
        this.tableType() === 'pending' ? {status: 'pending' as const} : {};
      const orgId = this.organizerId();
      return orgId ? {...base, organizerId: orgId} : base;
    },
    {
      onError: (error) => {
        logger.error('Operation failed', error);
        toast.error('failed to load applications');
      },
    },
  );
  readonly allApplications = computed<Application[]>(() => {
    const docs = this.applicationsQuery.data();
    if (!docs) return [];
    return this.tableType() === 'pending'
      ? this.appsService.mapApplications(docs)
      : this.appsService.mapHistoryApplications(docs);
  });

  readonly searchQuery = signal('');

  /** Shared admin datetime format for both desktop and mobile timestamps. */
  protected readonly ADMIN_DATETIME = ADMIN_DATETIME;

  /**
   * Rows with a mutation in flight, keyed by application id. Guards the
   * approve/reject/reinstate buttons against double-fire in zoneless mode.
   */
  private readonly pendingActions = signal<
    ReadonlyMap<string, ApplicationRowAction>
  >(new Map());

  readonly emptyStateMessage = computed(() => {
    const query = this.searchQuery();
    return query
      ? `no results for “${query}”`
      : `no ${this.tableType()} applications found`;
  });

  readonly filteredApplications = computed<Application[]>(() => {
    const apps = this.allApplications();
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return apps;
    return apps.filter((app) => {
      const name = app.user?.name?.toLowerCase() ?? '';
      const email = app.user?.email?.toLowerCase() ?? '';
      return name.includes(query) || email.includes(query);
    });
  });

  isLoading = this.applicationsQuery.isLoading;

  readonly vettingAnswersMap = computed<Map<string, VettingAnswer[]>>(() => {
    const apps = this.allApplications();
    const result = new Map<string, VettingAnswer[]>();

    for (const app of apps) {
      result.set(app._id, this.computeVettingAnswers(app));
    }

    return result;
  });

  /**
   * Get pre-computed vetting answers for an application.
   * O(1) lookup from the memoized map.
   */
  getVettingAnswers(app: Application): VettingAnswer[] {
    return this.vettingAnswersMap().get(app._id) ?? [];
  }

  /**
   * Compute vetting answers for a single application.
   * Called once per application when the signal updates.
   */
  private computeVettingAnswers(app: Application): VettingAnswer[] {
    const answers = (app.answers as Record<string, unknown>) || {};
    const visibleEntries: VettingAnswer[] = [];

    // 1. Determine questions (from organizer's vetting configuration)
    const questions = app.organizer?.vettingQuestions ?? [];

    // 2. Build a Set of known question IDs for O(1) lookup
    const knownQuestionIds = new Set(questions.map((q) => q.id));

    // 3. Map answers using known questions
    for (const q of questions) {
      const value = answers[q.id];
      if (value != null && value !== '') {
        visibleEntries.push({
          label:
            (q as {question?: string; label?: string}).question ||
            (q as {question?: string; label?: string}).label ||
            q.id,
          value,
        });
      }
    }

    // 4. Catch-all for any other keys not in known questions (except 'source')
    for (const [key, value] of Object.entries(answers)) {
      if (key === 'source') continue;
      if (
        !knownQuestionIds.has(key) &&
        value !== undefined &&
        value !== null &&
        value !== ''
      ) {
        visibleEntries.push({label: key, value});
      }
    }

    return visibleEntries;
  }

  isBoolean(val: unknown): boolean {
    return typeof val === 'boolean';
  }

  isArray(val: unknown): boolean {
    return Array.isArray(val);
  }

  asArray(val: unknown): unknown[] {
    return Array.isArray(val) ? val : [];
  }

  onSearchInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.searchQuery.set(target.value);
  }

  statusBadgeVariant(status: string): StatusBadgeVariant {
    return STATUS_BADGE_VARIANTS[status] ?? 'muted';
  }

  /** True when any action for this row is in flight. */
  isRowPending(app: Application): boolean {
    return this.pendingActions().has(app._id);
  }

  /** True when this specific action for this row is in flight. */
  isActionPending(app: Application, action: ApplicationRowAction): boolean {
    return this.pendingActions().get(app._id) === action;
  }

  private setRowPending(
    app: Application,
    action: ApplicationRowAction | null,
  ): void {
    this.pendingActions.update((current) => {
      const next = new Map(current);
      if (action === null) {
        next.delete(app._id);
      } else {
        next.set(app._id, action);
      }
      return next;
    });
  }

  updateStatus(app: Application, status: 'approved' | 'rejected') {
    if (this.isRowPending(app)) return;
    if (status === 'rejected') {
      this.dialog.create<
        ReasonDialogComponent,
        {visibilityLabel: string; reasonLabel?: string; placeholder?: string}
      >({
        zTitle: 'Reject Application',
        zDescription: `Are you sure you want to reject ${app.user?.name || 'this user'}?`,
        zOkText: 'Yes, Reject',
        zOkDestructive: true,
        zCancelText: 'Cancel',
        zContent: ReasonDialogComponent,
        zData: {
          visibilityLabel: 'VISIBLE TO THE APPLICANT (IN-APP + EMAIL)',
          reasonLabel: 'Deny reason',
          placeholder: 'Optional: tell the applicant why they were denied',
        },
        zOnOk: (instance) => {
          const denyReason = instance?.reason() || undefined;
          void this.performStatusUpdate(app, status, denyReason);
        },
      });
    } else {
      this.dialog.create({
        zTitle: 'Approve Application',
        zDescription: `Are you sure you want to approve ${app.user?.name || 'this user'}?`,
        zOkText: 'Yes, Approve',
        zOkDestructive: false,
        zCancelText: 'Cancel',
        zOnOk: () => {
          void this.performStatusUpdate(app, status);
        },
      });
    }
  }

  private async performStatusUpdate(
    app: Application,
    status: 'approved' | 'rejected',
    denyReason?: string,
  ) {
    if (this.isRowPending(app)) return;
    this.setRowPending(app, status);
    try {
      const processorId = this.auth.currentUser()?._id;
      if (!processorId) throw new Error('No admin user found');

      const userId = app.userId;

      if (status === 'approved') {
        await this.appsService.approve(app._id, userId, processorId);
      } else {
        await this.appsService.reject(app._id, processorId, denyReason);
      }

      toast.success(`application ${status}`);
    } catch (e) {
      logger.error('Operation failed', e);
      toast.error(
        `failed to ${status === 'approved' ? 'approve' : 'reject'} application`,
      );
    } finally {
      this.setRowPending(app, null);
    }
  }

  reinstateApplication(app: Application): void {
    if (this.isRowPending(app)) return;
    this.dialog.create({
      zTitle: 'Reinstate Membership',
      zDescription: `Are you sure you want to reinstate ${app.user?.name || 'this user'}? This will restore their community access.`,
      zOkText: 'Yes, Reinstate',
      zOkDestructive: false,
      zCancelText: 'Cancel',
      zOnOk: () => {
        void this.performReinstate(app, false);
      },
    });
  }

  private async performReinstate(app: Application, force: boolean) {
    if (this.isRowPending(app)) return;
    this.setRowPending(app, 'reinstate');
    let clearedForConflictDialog = false;
    try {
      const result = await this.appsService.reinstate(
        app._id,
        force || undefined,
      );

      if (result?.conflict === 'newer_application') {
        // The conflict dialog re-enters this method with force=true; release
        // the row guard first so that retry is not swallowed by it.
        this.setRowPending(app, null);
        clearedForConflictDialog = true;
        const status = result.newerStatus;
        const description =
          status === 'pending'
            ? `${app.user?.name || 'This user'} has a new application that is currently pending. Reinstating will restore access from their previous application. Proceed anyway?`
            : `${app.user?.name || 'This user'} has a newer application that was ${status}. Reinstating this older application will restore access despite the more recent decision. Proceed anyway?`;
        this.dialog.create({
          zTitle: 'Newer Application Exists',
          zDescription: description,
          zOkText: 'Yes, Reinstate Anyway',
          zOkDestructive: false,
          zCancelText: 'Cancel',
          zOnOk: () => {
            void this.performReinstate(app, true);
          },
        });
        return;
      }

      toast.success('membership reinstated');
    } catch (e) {
      logger.error('Operation failed', e);
      toast.error('failed to reinstate membership');
    } finally {
      // When the conflict dialog re-entered synchronously, the retry owns the
      // row guard now — do not clear it out from under that in-flight call.
      if (!clearedForConflictDialog) {
        this.setRowPending(app, null);
      }
    }
  }
}
