import {
  afterNextRender,
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {CdkTrapFocus} from '@angular/cdk/a11y';
import {DatePipe} from '@angular/common';
import {ActivatedRoute, Router} from '@angular/router';
import {toast} from 'ngx-sonner';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {AuthService} from '@/core/services/auth.service';
import {CommunitiesService} from '@/core/services/communities.service';
import {injectConvex, injectQuery, skipToken} from 'convex-angular';
import {
  DashboardShellComponent,
  type DashboardTab,
} from '@ui/components/composites/dashboard-shell/dashboard-shell.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';
import {type HasUnsavedChanges} from '../../guards/unsaved-changes.guard';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {CommunityContextService} from '@/features/admin/services/community-context.service';
import {CommunitySelectorComponent} from '@/features/admin/components/community-selector/community-selector.component';
import {AdminApplicationsTableComponent} from '@/features/admin/components/applications-table/applications-table.component';
import {AdminMembersTableComponent} from '@/features/admin/components/members-table/members-table.component';
import {AdminEventsTableComponent} from '@/features/admin/components/events-table/events-table.component';
import {CommunityAdminSettingsComponent} from '../community-admin-settings/community-admin-settings.component';
import {AdminOverrideBannerComponent} from '../../components/admin-override-banner/admin-override-banner.component';
import {AuditLogTableComponent} from '@/features/admin/components/audit-log-table/audit-log-table.component';
import {SharedVettingTableComponent} from '../../components/shared-vetting-table/shared-vetting-table.component';
import {ZardAlertComponent} from '@ui/components/primitives/alert/alert.component';
import {ZardTooltipDirective} from '@ui/components/primitives/tooltip/tooltip';
import {BraStatusBadgeComponent} from '@ui/components/primitives/status-badge/status-badge.component';
import {logger} from '@/utils/logger';
import {BrowserPlatformService} from '@/core/services/browser-platform.service';

type CommunityAdminTab =
  | 'magic-links'
  | 'pending'
  | 'history'
  | 'members'
  | 'events'
  | 'audit-log'
  | 'settings'
  | 'shared-vetting';
const VALID_TABS = new Set<CommunityAdminTab>([
  'magic-links',
  'pending',
  'history',
  'members',
  'events',
  'audit-log',
  'settings',
  'shared-vetting',
]);
const COMMUNITY_ADMIN_TABS: DashboardTab[] = [
  {id: 'pending', label: 'Pending Apps', path: '/community-admin/pending'},
  {id: 'history', label: 'App History', path: '/community-admin/history'},
  {id: 'members', label: 'Members', path: '/community-admin/members'},
  {id: 'events', label: 'Events', path: '/community-admin/events'},
  {
    id: 'magic-links',
    label: 'Magic Links',
    path: '/community-admin/magic-links',
  },
  {id: 'audit-log', label: 'Audit Log', path: '/community-admin/audit-log'},
  {
    id: 'shared-vetting',
    label: 'Shared Vetting',
    path: '/community-admin/shared-vetting',
  },
  {id: 'settings', label: 'Settings', path: '/community-admin/settings'},
];

@Component({
  selector: 'app-community-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CdkTrapFocus,
    DatePipe,
    DashboardShellComponent,
    ZardButtonComponent,
    ZardIconComponent,
    ZardInputDirective,
    ZardSkeletonComponent,
    CommunitySelectorComponent,
    AdminApplicationsTableComponent,
    AdminMembersTableComponent,
    AdminEventsTableComponent,
    CommunityAdminSettingsComponent,
    AdminOverrideBannerComponent,
    AuditLogTableComponent,
    SharedVettingTableComponent,
    ZardAlertComponent,
    ZardTooltipDirective,
    BraStatusBadgeComponent,
  ],
  templateUrl: './community-admin.component.html',
})
export class CommunityAdminComponent implements HasUnsavedChanges {
  private readonly auth = inject(AuthService);
  private readonly communitiesService = inject(CommunitiesService);
  private readonly convex = injectConvex();
  readonly communityCtx = inject(CommunityContextService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly queryParamMap = toSignal(this.route.queryParamMap, {
    requireSync: true,
  });
  private readonly routeParamMap = toSignal(this.route.paramMap, {
    requireSync: true,
  });
  private readonly alertDialog = inject(BraAlertDialogService);
  private readonly browser = inject(BrowserPlatformService);
  private readonly injector = inject(Injector);
  private readonly settingsComponent = viewChild(
    CommunityAdminSettingsComponent,
  );
  private readonly lastHandledCommunityParam = signal<string | null>(null);

  private readonly isMemberOfQuery = injectQuery(
    api.communities.admins.isMemberOf,
    () => {
      const id = this.communityCtx.selectedCommunityId();
      return id ? {organizerId: id} : skipToken;
    },
  );

  readonly isAdminOverride = computed(() => {
    return (
      this.auth.userRole() === 'root_admin' &&
      this.isMemberOfQuery.data() === false
    );
  });

  /** Full community document for the selected community (logo, status, etc.) */
  private readonly communityQuery = injectQuery(
    api.communities.public.get,
    () => {
      const id = this.communityCtx.selectedCommunityId();
      return id ? {id} : skipToken;
    },
  );
  readonly communityDoc = computed(() => this.communityQuery.data() ?? null);
  readonly communityName = computed(
    () =>
      this.communityDoc()?.name ?? this.communityCtx.selectedCommunityName(),
  );
  readonly communityLogo = computed(() => this.communityDoc()?.logoUrl ?? null);
  readonly communityStatus = computed(
    () => this.communityDoc()?.status ?? 'draft',
  );
  readonly tabQueryParams = computed(() => {
    const selectedId = this.communityCtx.selectedCommunityId();
    if (!selectedId) return null;
    const slug = this.communityDoc()?.slug ?? null;
    return {community: slug ?? selectedId};
  });

  constructor() {
    effect(() => {
      const qp = this.queryParamMap();
      const legacyOrgId = qp.get('organizerId');
      const communityParam = qp.get('community') ?? legacyOrgId;

      if (!communityParam) {
        this.lastHandledCommunityParam.set(null);
        this.unresolvedCommunitySlug.set(null);
        return;
      }
      if (untracked(() => this.lastHandledCommunityParam()) === communityParam)
        return;
      this.lastHandledCommunityParam.set(communityParam);

      if (legacyOrgId && !qp.get('community')) {
        afterNextRender(
          () => {
            void this.router.navigate([], {
              relativeTo: this.route,
              queryParams: {organizerId: null, community: legacyOrgId},
              queryParamsHandling: 'merge',
              replaceUrl: true,
            });
          },
          {injector: this.injector},
        );
      }

      void this.loadCommunityBySlugOrId(communityParam);
    });
  }

  readonly tabs = COMMUNITY_ADMIN_TABS;
  readonly tab = input<string>();
  readonly activeTab = computed<CommunityAdminTab>(() => {
    const t = this.routeParamMap().get('tab') ?? this.tab();
    if (t && VALID_TABS.has(t as CommunityAdminTab)) {
      return t as CommunityAdminTab;
    }
    return 'pending';
  });

  isDirty(): boolean {
    return (
      this.activeTab() === 'settings' &&
      (this.settingsComponent()?.isDirty() ?? false)
    );
  }

  readonly handleBeforeTabChange = (
    _tab: DashboardTab,
  ): Promise<boolean> | boolean => {
    if (!this.isDirty()) return true;
    return new Promise<boolean>((resolve) => {
      this.alertDialog.confirm({
        zTitle: 'Unsaved Changes',
        zDescription:
          'You have unsaved changes that will be lost. Are you sure you want to leave?',
        zOkText: 'Discard Changes',
        zCancelText: 'Keep Editing',
        zOkDestructive: true,
        zMaskClosable: false,
        zOnOk: () => resolve(true),
        zOnCancel: () => resolve(false),
      });
    });
  };

  readonly unresolvedCommunitySlug = signal<string | null>(null);

  private async loadCommunityBySlugOrId(slugOrId: string): Promise<void> {
    try {
      const community = await this.communitiesService.getBySlugOrId(slugOrId);
      if (!this.isLatestCommunityParam(slugOrId)) return;
      if (!community) {
        this.unresolvedCommunitySlug.set(slugOrId);
        return;
      }
      this.unresolvedCommunitySlug.set(null);
      this.communityCtx.selectCommunity(community._id);
    } catch (error) {
      if (!this.isLatestCommunityParam(slugOrId)) return;
      logger.error('Failed to resolve ?community slug', error);
      this.unresolvedCommunitySlug.set(slugOrId);
    }
  }

  private isLatestCommunityParam(slugOrId: string): boolean {
    return untracked(() => this.lastHandledCommunityParam()) === slugOrId;
  }

  pickCommunity(id: Id<'organizers'>): void {
    this.unresolvedCommunitySlug.set(null);
    this.communityCtx.selectCommunity(id);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {community: null},
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  private readonly linksQuery = injectQuery(
    api.communities.invite_links.listMyLinks,
    () => (this.activeTab() === 'magic-links' ? {} : skipToken),
    {
      onError: (error) => {
        logger.error('Failed to load magic links', error);
        toast.error('Failed to load your magic links');
      },
    },
  );

  private readonly linksPastQuery = injectQuery(
    api.communities.invite_links.listPastMyLinks,
    () => (this.activeTab() === 'magic-links' ? {} : skipToken),
    {
      onError: (error) => {
        logger.error('Failed to load past magic links', error);
        toast.error('Failed to load past magic links');
      },
    },
  );

  /** Raw query data or empty array while loading */
  readonly links = computed(() => this.linksQuery.data() ?? []);
  isLoading = this.linksQuery.isLoading;

  readonly linksFilter = signal<'active' | 'past'>('active');
  readonly pastLinks = computed(() => this.linksPastQuery.data() ?? []);
  readonly pastLinksCount = computed(() => this.pastLinks().length);

  /** Summary stats */
  readonly totalLinks = computed(() => this.links().length);
  readonly totalRedemptions = computed(() =>
    this.links().reduce((sum, link) => sum + link.redemptionCount, 0),
  );
  readonly activeLinks = computed(
    () => this.links().filter((link) => link.status === 'active').length,
  );

  /** Create dialog state */
  readonly isCreateDialogOpen = signal(false);
  readonly isCreating = signal(false);
  readonly createFormLabel = signal('');
  readonly createFormMaxRedemptions = signal('');
  readonly createFormExpires = signal('');
  readonly clipboardStatus = signal<string | null>(null);

  openCreateDialog() {
    this.createFormLabel.set('');
    this.createFormMaxRedemptions.set('');
    this.createFormExpires.set('');
    this.isCreateDialogOpen.set(true);
  }

  closeCreateDialog() {
    this.isCreateDialogOpen.set(false);
  }

  async createLink() {
    if (this.isCreating()) return;
    this.isCreating.set(true);

    try {
      const organizerId = this.communityCtx.selectedCommunityId();
      if (!organizerId) {
        toast.error('Select a community before creating a magic link');
        return;
      }

      const label = this.createFormLabel().trim() || undefined;
      const maxStr = this.createFormMaxRedemptions().trim();
      const maxRedemptions = maxStr ? parseInt(maxStr, 10) : undefined;
      const expiresStr = this.createFormExpires().trim();
      const expiresAt = expiresStr ? new Date(expiresStr).getTime() : undefined;

      if (
        maxRedemptions !== undefined &&
        (isNaN(maxRedemptions) || maxRedemptions < 1)
      ) {
        toast.error('Max redemptions must be at least 1');
        this.isCreating.set(false);
        return;
      }

      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        toast.error('Expiration date must be in the future');
        this.isCreating.set(false);
        return;
      }

      const result = await this.convex.mutation(
        api.communities.invite_links.create,
        {
          organizerId,
          label,
          expiresAt,
          maxRedemptions,
        },
      );

      toast.success('Magic link created');
      this.closeCreateDialog();

      // Auto-copy the new link using current origin
      await this.copyToClipboard(
        this.browser.absoluteUrl(`/invite/${result.token}`),
      );
    } catch (e) {
      logger.error('Failed to create magic link', e);
      const message = e instanceof Error ? e.message : 'Failed to create link';
      toast.error(message);
    } finally {
      this.isCreating.set(false);
    }
  }

  async copyLink(token: string, link?: {label?: string; tokenPrefix?: string}) {
    const url = this.browser.absoluteUrl(`/invite/${token}`);
    const identifier = link ? this.getLinkIdentifier(link) : token.slice(0, 8);
    await this.copyClipboardWithFeedback(
      url,
      `Copied link for ${identifier}`,
      'Failed to copy link',
    );
  }

  async updateLinkStatus(
    linkId: Id<'magic_links'>,
    action: 'pause' | 'resume' | 'delete',
  ) {
    try {
      await this.convex.mutation(api.communities.invite_links.updateStatus, {
        linkId,
        action,
      });
      const labels: Record<string, string> = {
        pause: 'Link paused',
        resume: 'Link resumed',
        delete: 'Link deleted',
      };
      toast.success(labels[action]);
    } catch (e) {
      logger.error(`Failed to ${action} link`, e);
      const message =
        e instanceof Error ? e.message : `Failed to ${action} link`;
      toast.error(message);
    }
  }

  confirmPause(linkId: Id<'magic_links'>, label: string | undefined) {
    this.alertDialog.confirm({
      zTitle: 'Pause Link',
      zDescription: `Pause "${label || 'this link'}"? Visitors will not be able to use it until you resume it.`,
      zOkText: 'Pause Link',
      zCancelText: 'Keep Active',
      zMaskClosable: false,
      zOnOk: () => this.updateLinkStatus(linkId, 'pause'),
    });
  }

  confirmDelete(linkId: Id<'magic_links'>, label: string | undefined) {
    this.alertDialog.confirm({
      zTitle: 'Delete Link',
      zDescription: `Permanently delete "${label || 'this link'}"? This cannot be undone.`,
      zOkText: 'Delete Link',
      zOkDestructive: true,
      zCancelText: 'Cancel',
      zMaskClosable: false,
      zOnOk: () => this.updateLinkStatus(linkId, 'delete'),
    });
  }

  getLinkIdentifier(link: {label?: string; tokenPrefix?: string}): string {
    return link.label || link.tokenPrefix || 'Link';
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      await this.browser.writeClipboardText(text);
      return true;
    } catch {
      return false;
    }
  }

  private async copyClipboardWithFeedback(
    text: string,
    successMessage: string,
    errorMessage: string,
  ): Promise<void> {
    const copied = await this.copyToClipboard(text);
    this.clipboardStatus.set(copied ? successMessage : errorMessage);
    if (copied) {
      toast.success(successMessage);
    } else {
      toast.error(errorMessage);
    }
  }
}
