import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {RouterLink} from '@angular/router';
import {injectQuery} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Community} from '@/core/services/communities.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {
  InviteAdminDialogComponent,
  type InviteAdminDialogCloseResult,
} from '@/features/admin/components/invite-admin-dialog/invite-admin-dialog.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {BraStatusBadgeComponent} from '@ui/components/primitives/status-badge/status-badge.component';

@Component({
  selector: 'app-admin-community-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ZardButtonComponent,
    ZardIconComponent,
    EmptyStateComponent,
    ZardSkeletonComponent,
    ZardCardComponent,
    BraStatusBadgeComponent,
  ],
  template: `
    <div class="space-y-8">
      <div
        class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
      >
        <div class="space-y-2">
          <h1
            class="font-display text-2xl font-bold tracking-tight text-foreground uppercase sm:text-3xl lg:text-4xl"
          >
            Communities
          </h1>
          <p class="font-mono text-sm text-muted-foreground">
            Manage event communities and their settings.
          </p>
        </div>
        <div
          class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
          data-testid="community-header-actions"
        >
          <button
            type="button"
            z-button
            zType="ghost"
            (click)="openInviteDialog()"
            class="w-full sm:w-auto"
            data-testid="invite-admin-btn"
          >
            <z-icon zType="user-plus" class="mr-2" />
            Invite Admin
          </button>
          <a
            routerLink="/admin/communities/new"
            z-button
            class="w-full sm:w-auto"
            data-testid="create-community-btn"
          >
            <z-icon zType="plus" class="mr-2" />
            Create Community
          </a>
        </div>
      </div>

      <!-- Desktop Table View -->
      <div
        class="hidden overflow-hidden rounded-xl border border-border bg-card shadow-2xl md:block"
      >
        <table class="w-full border-collapse text-left">
          <thead class="border-b border-border bg-muted">
            <tr>
              <th class="mono-label px-6 py-4 text-xs text-muted-foreground">
                Name
              </th>
              <th class="mono-label px-6 py-4 text-xs text-muted-foreground">
                Email
              </th>
              <th class="mono-label px-6 py-4 text-xs text-muted-foreground">
                Status
              </th>
              <th
                class="mono-label px-6 py-4 text-right text-xs text-muted-foreground"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            @if (isLoading()) {
              @for (i of [1, 2, 3, 4, 5]; track i) {
                <tr data-testid="desktop-skeleton-row">
                  <td class="px-6 py-4">
                    <z-skeleton zAnimation="shimmer" class="h-5 w-48" />
                    <z-skeleton zAnimation="shimmer" class="mt-1 h-3 w-32" />
                  </td>
                  <td class="px-6 py-4">
                    <z-skeleton zAnimation="shimmer" class="h-4 w-40" />
                  </td>
                  <td class="px-6 py-4">
                    <z-skeleton
                      zAnimation="shimmer"
                      class="h-5 w-20 rounded-sm"
                    />
                  </td>
                  <td class="flex justify-end gap-2 px-6 py-4">
                    <z-skeleton zAnimation="shimmer" class="h-8 w-16" />
                    <z-skeleton zAnimation="shimmer" class="h-8 w-16" />
                  </td>
                </tr>
              }
            } @else {
              @for (community of communities(); track community._id) {
                <tr
                  class="border-b border-border/50 transition-colors hover:bg-muted/40"
                  data-testid="community-entry"
                >
                  <td class="px-6 py-4">
                    <span class="text-sm font-medium text-foreground">{{
                      community.name
                    }}</span>
                    @if (community.contactInfo) {
                      <div class="mt-1 font-mono text-xs text-muted-foreground">
                        {{ community.contactInfo }}
                      </div>
                    }
                  </td>
                  <td class="px-6 py-4 font-mono text-sm text-muted-foreground">
                    {{ community.email || '—' }}
                  </td>
                  <td class="px-6 py-4">
                    <bra-status-badge
                      [status]="
                        community.status === 'draft' ? 'warning' : 'primary'
                      "
                      [class]="
                        community.status === 'draft' ? '' : 'text-foreground'
                      "
                      data-testid="community-status-badge"
                      >{{
                        community.status === 'draft' ? 'draft' : 'published'
                      }}</bra-status-badge
                    >
                  </td>
                  <td class="px-6 py-4 text-right">
                    <a
                      [routerLink]="['/community-admin/pending']"
                      [queryParams]="{
                        community: community.slug ?? community._id,
                      }"
                      z-button
                      zType="ghost"
                      zSize="sm"
                      class="font-mono text-2xs tracking-widest text-foreground uppercase"
                      data-testid="manage-community-btn"
                    >
                      Manage
                    </a>
                    <a
                      [routerLink]="[
                        '/admin/communities',
                        community._id,
                        'edit',
                      ]"
                      z-button
                      zType="ghost"
                      zSize="sm"
                      class="text-muted-foreground hover:bg-muted hover:text-foreground"
                      data-testid="edit-community-btn"
                    >
                      <z-icon zType="pencil" class="mr-2" />
                      Edit
                    </a>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="4" class="p-0">
                    <app-empty-state title="No communities found" />
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>

      <!-- Mobile Card View -->
      <div class="space-y-4 md:hidden">
        @if (isLoading()) {
          @for (i of [1, 2, 3]; track i) {
            <div
              data-testid="mobile-skeleton-card"
              class="space-y-4 rounded-xl border border-border bg-card/80 p-6"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <z-skeleton zAnimation="shimmer" class="h-5 w-40" />
                  <z-skeleton zAnimation="shimmer" class="h-3 w-24" />
                </div>
                <z-skeleton
                  zAnimation="shimmer"
                  class="h-5 w-20 shrink-0 rounded-sm"
                />
              </div>
              <div class="space-y-1 border-y border-border/50 py-3">
                <z-skeleton zAnimation="shimmer" class="h-3 w-12" />
                <z-skeleton zAnimation="shimmer" class="h-4 w-48" />
              </div>
              <div class="flex gap-2">
                <z-skeleton zAnimation="shimmer" class="h-8 w-20" />
                <z-skeleton zAnimation="shimmer" class="h-8 flex-1" />
              </div>
            </div>
          }
        } @else {
          @for (
            community of communities();
            track community._id;
            let i = $index
          ) {
            <z-card
              [class]="
                'animate-in fade-in slide-in-from-bottom-8 border-border bg-card/80 transition-transform duration-300 motion-safe:hover:scale-[1.01] ' +
                (i === 0
                  ? 'delay-75'
                  : i === 1
                    ? 'delay-150'
                    : i === 2
                      ? 'delay-225'
                      : 'delay-300')
              "
              [zTitle]="communityHeader"
              role="article"
              data-testid="community-entry"
            >
              <ng-template #communityHeader>
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <div
                      class="font-display text-lg font-bold tracking-wide text-foreground"
                    >
                      {{ community.name }}
                    </div>
                    @if (community.contactInfo) {
                      <div class="mt-1 font-mono text-xs text-muted-foreground">
                        {{ community.contactInfo }}
                      </div>
                    }
                  </div>
                  <bra-status-badge
                    [status]="
                      community.status === 'draft' ? 'warning' : 'primary'
                    "
                    [class]="
                      community.status === 'draft'
                        ? 'shrink-0'
                        : 'shrink-0 text-foreground'
                    "
                    data-testid="community-status-badge"
                    >{{
                      community.status === 'draft' ? 'draft' : 'published'
                    }}</bra-status-badge
                  >
                </div>
              </ng-template>

              <div class="border-y border-border/50 py-3">
                <div
                  class="mb-1 font-mono text-2xs text-muted-foreground uppercase"
                >
                  Email
                </div>
                <div class="font-mono text-sm break-all text-foreground/80">
                  {{ community.email || '—' }}
                </div>
              </div>

              <div card-footer class="pt-0">
                <div class="flex gap-2">
                  <a
                    [routerLink]="['/community-admin/pending']"
                    [queryParams]="{community: community.slug ?? community._id}"
                    z-button
                    zType="ghost"
                    zSize="sm"
                    class="font-mono text-2xs tracking-widest text-foreground uppercase"
                    data-testid="manage-community-btn"
                  >
                    Manage
                  </a>
                  <a
                    [routerLink]="['/admin/communities', community._id, 'edit']"
                    z-button
                    zType="default"
                    class="flex-1"
                    data-testid="edit-community-btn"
                  >
                    <z-icon zType="pencil" class="mr-2" />
                    Edit Community
                  </a>
                </div>
              </div>
            </z-card>
          } @empty {
            <app-empty-state title="No communities found" />
          }
        }
      </div>
    </div>
  `,
})
export class AdminCommunityListComponent {
  private readonly dialog = inject(BraDialogService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly communitiesQuery = injectQuery(
    api.communities.list.list,
    () => ({}),
  );

  readonly communities = computed<Community[]>(
    () => this.communitiesQuery.data() ?? [],
  );
  protected readonly isLoading = this.communitiesQuery.isLoading;

  loadCommunities() {
    this.communitiesQuery.refetch();
  }

  openInviteDialog(): void {
    const dialogRef = this.dialog.create<InviteAdminDialogComponent, unknown>({
      zTitle: 'Invite Admin',
      zDescription: 'Create a new community and send an invite to its admin.',
      zContent: InviteAdminDialogComponent,
      zHideFooter: true,
      zWidth: '420px',
    });

    dialogRef.afterClosed$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (!this.shouldRefreshCommunities(result)) {
          return;
        }

        this.loadCommunities();
      });
  }

  private shouldRefreshCommunities(
    result: unknown,
  ): result is InviteAdminDialogCloseResult {
    return (
      typeof result === 'object' &&
      result !== null &&
      'refreshCommunities' in result &&
      result.refreshCommunities === true
    );
  }
}
