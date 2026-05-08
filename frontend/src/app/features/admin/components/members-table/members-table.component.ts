import {DatePipe, UpperCasePipe} from '@angular/common';
import {
  Component,
  inject,
  input,
  signal,
  effect,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  MembersService,
  type MemberWithApplication,
} from '@/features/admin/services/members.service';
import {ApplicationsService} from '@/features/vetting/services/applications.service';
import {AuthService} from '@/core/services/auth.service';
import {injectPaginatedQuery, skipToken} from 'convex-angular';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {ReasonDialogComponent} from '../reason-dialog/reason-dialog.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {toast} from 'ngx-sonner';
import {logger} from '@/utils/logger';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';

type MemberFilter = 'all' | 'ours' | 'shared';

@Component({
  selector: 'app-admin-members-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    UpperCasePipe,
    ZardButtonComponent,
    ZardCardComponent,
    ZardSkeletonComponent,
  ],
  templateUrl: './members-table.component.html',
})
// NOTE: Template uses bracket notation for optional user fields. Dot notation works equally
// well since Doc<'users'> includes these fields. Bracket notation is used consistently across
// the template for all optional user fields (name, email).
export class AdminMembersTableComponent {
  private membersService = inject(MembersService);
  private appsService = inject(ApplicationsService);
  private auth = inject(AuthService);
  private dialog = inject(BraDialogService);

  readonly organizerId = input<Id<'organizers'> | undefined>(undefined);

  private readonly pageSize = 20;
  private readonly showLoadMoreErrorToast = signal(false);

  private readonly membersQuery = injectPaginatedQuery(
    api.users.profile.listWithApplications,
    () => {
      const orgId = this.organizerId();
      return orgId ? {organizerId: orgId} : skipToken;
    },
    {
      initialNumItems: this.pageSize,
      onError: (error) => {
        logger.error('Operation failed', error);
        toast.error(
          this.showLoadMoreErrorToast()
            ? 'Failed to load more members'
            : 'Failed to load members',
        );
        this.showLoadMoreErrorToast.set(false);
      },
    },
  );

  members = this.membersQuery.results;
  isDone = this.membersQuery.isExhausted;
  isLoadingMore = this.membersQuery.isLoadingMore;

  isLoading = this.membersQuery.isLoadingFirstPage;

  readonly memberFilter = signal<MemberFilter>('all');

  readonly activeMembers = computed(() =>
    this.members().filter((member) => this.hasCommunityAccess(member)),
  );

  readonly filteredMembers = computed(() => {
    const activeMembers = this.activeMembers();
    const filter = this.memberFilter();
    if (filter === 'all') return activeMembers;
    if (filter === 'ours') {
      return activeMembers.filter((m) => m.communityAccessSource !== 'shared');
    }
    return activeMembers.filter((m) => m.communityAccessSource === 'shared');
  });

  setMemberFilter(filter: MemberFilter): void {
    this.memberFilter.set(filter);
  }

  constructor() {
    effect(() => {
      const isLoadingMore = this.membersQuery.isLoadingMore();
      const error = this.membersQuery.error();
      if (!isLoadingMore && !error) {
        this.showLoadMoreErrorToast.set(false);
      }
    });
  }

  /** Refresh data (resets pagination to first page) */
  private refreshData() {
    this.showLoadMoreErrorToast.set(false);
    this.membersQuery.reset();
  }

  loadMore() {
    if (this.isLoadingMore() || this.isDone()) return;

    this.showLoadMoreErrorToast.set(true);
    const started = this.membersQuery.loadMore(this.pageSize);
    if (!started) {
      this.showLoadMoreErrorToast.set(false);
    }
  }

  isCurrentUser(member: MemberWithApplication): boolean {
    return member.user._id === this.auth.currentUser()?._id;
  }

  hasCommunityAccess(member: MemberWithApplication): boolean {
    return member.communityAccessSource !== undefined;
  }

  getMemberStatusLabel(member: MemberWithApplication): string {
    switch (member.communityAccessSource) {
      case 'approved_application':
        return 'APPROVED';
      case 'magic_link':
        return 'MAGIC LINK';
      case 'direct_member':
        return 'DIRECT MEMBER';
      case 'shared':
        return 'SHARED';
      case undefined:
        return member.application?.status.toUpperCase() ?? 'NO APPLICATION';
      default:
        return 'UNKNOWN';
    }
  }

  memberActionLabel(member: MemberWithApplication): string {
    const name = member.user['name'] || member.user['email'] || 'member';
    const email =
      member.user['email'] && member.user['email'] !== name
        ? `, ${member.user['email']}`
        : '';
    return `${name}${email}, id ${this.idSuffix(member.user._id)}`;
  }

  shouldShowTrustSource(member: MemberWithApplication): boolean {
    return (
      member.communityAccessSource === 'shared' &&
      member.trustedViaOrganizerName !== undefined
    );
  }

  isSharedAccess(member: MemberWithApplication): boolean {
    return member.communityAccessSource === 'shared';
  }

  canRevokeMembership(member: MemberWithApplication): boolean {
    return (
      this.hasCommunityAccess(member) &&
      !this.isCurrentUser(member) &&
      !this.isSharedAccess(member)
    );
  }

  private shouldRevokeViaApplication(member: MemberWithApplication): boolean {
    return (
      member.communityAccessSource === 'approved_application' &&
      member.application?.status === 'approved'
    );
  }

  canReviewApplication(member: MemberWithApplication): boolean {
    return member.application?.status === 'pending';
  }

  revokeMembership(member: MemberWithApplication): void {
    if (!this.canRevokeMembership(member)) {
      return;
    }

    this.dialog.create<ReasonDialogComponent, {visibilityLabel: string}>({
      zTitle: 'Revoke Membership',
      zDescription: `Are you sure you want to revoke membership for ${member.user['name']}? This will remove their ticket access.`,
      zOkText: 'Yes, Revoke',
      zOkDestructive: true,
      zCancelText: 'Cancel',
      zContent: ReasonDialogComponent,
      zData: {visibilityLabel: 'VISIBLE TO THE MEMBER'},
      zOnOk: (instance) => {
        const reason = instance?.reason() || undefined;
        void this.performRevoke(member, reason);
      },
    });
  }

  private async performRevoke(member: MemberWithApplication, reason?: string) {
    try {
      if (this.shouldRevokeViaApplication(member) && member.application) {
        // applications.revoke is the canonical direct-approval revocation path.
        const processorId = this.auth.currentUser()?._id;
        if (!processorId) throw new Error('No user');
        await this.appsService.revoke(
          member.application._id,
          processorId,
          reason,
        );
      } else {
        // Shared and magic-link access are revoked with an organizer-scoped record.
        const organizerId = this.organizerId();
        if (!organizerId) throw new Error('Missing organizer ID');
        await this.membersService.revokeMembership(
          member.user._id,
          organizerId,
        );
      }

      toast.success('Membership revoked');
      this.refreshData();
    } catch (e) {
      logger.error('Operation failed', e);
      toast.error('Failed to revoke membership');
    }
  }

  updateAppStatus(
    member: MemberWithApplication,
    status: 'approved' | 'rejected',
  ): void {
    if (!member.application) return;
    if (!this.canReviewApplication(member)) {
      toast.error('Only pending applications can be approved or rejected');
      return;
    }

    if (status === 'rejected') {
      this.dialog.create<
        ReasonDialogComponent,
        {visibilityLabel: string; reasonLabel?: string; placeholder?: string}
      >({
        zTitle: 'Reject Application',
        zDescription: `Are you sure you want to reject ${member.user['name']}?`,
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
          void this.performAppStatusUpdate(member, status, denyReason);
        },
      });
    } else {
      void this.performAppStatusUpdate(member, status);
    }
  }

  private async performAppStatusUpdate(
    member: MemberWithApplication,
    status: 'approved' | 'rejected',
    denyReason?: string,
  ) {
    if (!member.application) return;

    try {
      const processorId = this.auth.currentUser()?._id;
      if (!processorId) throw new Error('No user');
      if (status === 'approved') {
        await this.appsService.approve(
          member.application._id,
          member.user._id,
          processorId,
        );
      } else {
        await this.appsService.reject(
          member.application._id,
          processorId,
          denyReason,
        );
      }
      toast.success(`Membership application ${status}`);
      this.refreshData();
    } catch (e) {
      logger.error('Operation failed', e);
      toast.error(`Failed to ${status}`);
    }
  }

  private idSuffix(id: string): string {
    return (id.length <= 8 ? id : id.slice(-6)).toUpperCase();
  }
}
