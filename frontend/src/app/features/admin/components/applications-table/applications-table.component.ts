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
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {ReasonDialogComponent} from '@/features/admin/components/reason-dialog/reason-dialog.component';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';

interface VettingAnswer {
  label: string;
  value: unknown;
}

@Component({
  selector: 'app-admin-applications-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    ZardButtonComponent,
    ZardInputDirective,
    ZardSkeletonComponent,
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
        toast.error('Failed to load applications');
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

  updateStatus(app: Application, status: 'approved' | 'rejected') {
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
    try {
      const processorId = this.auth.currentUser()?._id;
      if (!processorId) throw new Error('No admin user found');

      const userId = app.userId;

      if (status === 'approved') {
        await this.appsService.approve(app._id, userId, processorId);
      } else {
        await this.appsService.reject(app._id, processorId, denyReason);
      }

      toast.success(`Application ${status}`);
    } catch (e) {
      logger.error('Operation failed', e);
      toast.error(`Failed to ${status} application`);
    }
  }

  reinstateApplication(app: Application): void {
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
    try {
      const result = await this.appsService.reinstate(
        app._id,
        force || undefined,
      );

      if (result?.conflict === 'newer_application') {
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

      toast.success('Membership reinstated');
    } catch (e) {
      logger.error('Operation failed', e);
      toast.error('Failed to reinstate membership');
    }
  }
}
