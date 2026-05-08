import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  resource,
  signal,
} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {RouterLink} from '@angular/router';
import {
  CommunitiesService,
  type Community,
} from '@/core/services/communities.service';
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
import {safeResourceValue} from '@/utils/resource';

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
  ],
  template: `
    <div class="space-y-8">
      <div
        class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"
      >
        <div class="space-y-2">
          <h1
            class="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground tracking-tight font-display uppercase"
          >
            Communities
          </h1>
          <p class="text-sm text-muted-foreground font-mono">
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
        class="hidden md:block rounded-xl border border-border bg-card overflow-hidden shadow-2xl"
      >
        <table class="w-full text-left border-collapse">
          <thead class="bg-muted border-b border-border">
            <tr>
              <th class="px-6 py-4 text-xs mono-label text-muted-foreground">
                Name
              </th>
              <th class="px-6 py-4 text-xs mono-label text-muted-foreground">
                Email
              </th>
              <th class="px-6 py-4 text-xs mono-label text-muted-foreground">
                Status
              </th>
              <th
                class="px-6 py-4 text-xs mono-label text-muted-foreground text-right"
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
                    <z-skeleton zAnimation="shimmer" class="w-48 h-5" />
                    <z-skeleton zAnimation="shimmer" class="w-32 h-3 mt-1" />
                  </td>
                  <td class="px-6 py-4">
                    <z-skeleton zAnimation="shimmer" class="w-40 h-4" />
                  </td>
                  <td class="px-6 py-4">
                    <z-skeleton
                      zAnimation="shimmer"
                      class="w-20 h-5 rounded-sm"
                    />
                  </td>
                  <td class="px-6 py-4 flex justify-end gap-2">
                    <z-skeleton zAnimation="shimmer" class="w-16 h-8" />
                    <z-skeleton zAnimation="shimmer" class="w-16 h-8" />
                  </td>
                </tr>
              }
            } @else {
              @for (community of communities(); track community._id) {
                <tr
                  class="border-b border-border/50 hover:bg-muted/40 transition-colors"
                  data-testid="community-entry"
                >
                  <td class="px-6 py-4">
                    <span class="text-sm font-medium text-foreground">{{
                      community.name
                    }}</span>
                    @if (community.contactInfo) {
                      <div class="text-xs text-muted-foreground font-mono mt-1">
                        {{ community.contactInfo }}
                      </div>
                    }
                  </td>
                  <td class="px-6 py-4 text-sm font-mono text-muted-foreground">
                    {{ community.email || '—' }}
                  </td>
                  <td class="px-6 py-4">
                    <span
                      [class]="
                        'inline-flex items-center px-2 py-0.5 font-mono text-2xs uppercase tracking-widest border ' +
                        (community.status === 'draft'
                          ? 'text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10'
                          : 'text-primary border-primary/40 bg-primary/10')
                      "
                      data-testid="community-status-badge"
                      >{{
                        community.status === 'draft' ? 'Draft' : 'Published'
                      }}</span
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
                      class="font-mono uppercase tracking-widest text-2xs"
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
                      class="text-muted-foreground hover:text-foreground hover:bg-muted"
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
      <div class="md:hidden space-y-4">
        @if (isLoading()) {
          @for (i of [1, 2, 3]; track i) {
            <div
              data-testid="mobile-skeleton-card"
              class="rounded-xl border border-border bg-card/80 p-6 space-y-4"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="space-y-1">
                  <z-skeleton zAnimation="shimmer" class="h-5 w-40" />
                  <z-skeleton zAnimation="shimmer" class="h-3 w-24" />
                </div>
                <z-skeleton
                  zAnimation="shimmer"
                  class="h-5 w-20 rounded-sm shrink-0"
                />
              </div>
              <div class="py-3 border-y border-border/50 space-y-1">
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
                'border-border bg-card/80 transition-transform duration-300 motion-safe:hover:scale-[1.01] animate-in fade-in slide-in-from-bottom-8 ' +
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
                      class="font-bold text-foreground font-display text-lg tracking-wide"
                    >
                      {{ community.name }}
                    </div>
                    @if (community.contactInfo) {
                      <div class="text-xs text-muted-foreground font-mono mt-1">
                        {{ community.contactInfo }}
                      </div>
                    }
                  </div>
                  <span
                    [class]="
                      'inline-flex items-center px-2 py-0.5 font-mono text-2xs uppercase tracking-widest border shrink-0 ' +
                      (community.status === 'draft'
                        ? 'text-amber-600 dark:text-amber-400 border-amber-500/40 bg-amber-500/10'
                        : 'text-primary border-primary/40 bg-primary/10')
                    "
                    data-testid="community-status-badge"
                    >{{
                      community.status === 'draft' ? 'Draft' : 'Published'
                    }}</span
                  >
                </div>
              </ng-template>

              <div class="py-3 border-y border-border/50">
                <div
                  class="text-muted-foreground text-2xs uppercase font-mono mb-1"
                >
                  Email
                </div>
                <div class="text-foreground/80 font-mono text-sm break-all">
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
                    class="font-mono uppercase tracking-widest text-2xs"
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
  private readonly communitiesService = inject(CommunitiesService);
  private readonly dialog = inject(BraDialogService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly refreshTrigger = signal(0);

  private communitiesResource = resource({
    params: () => ({trigger: this.refreshTrigger()}),
    loader: () => this.communitiesService.list(),
  });

  readonly communities = computed<Community[]>(
    () => safeResourceValue(this.communitiesResource) ?? [],
  );
  protected readonly isLoading = this.communitiesResource.isLoading;

  loadCommunities() {
    this.refreshTrigger.update((v) => v + 1);
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
