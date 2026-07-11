import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  resource,
  signal,
} from '@angular/core';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {RouterLink} from '@angular/router';
import {PublicCommunitiesService} from '@/core/services/public-communities.service';
import {api} from '@convex/_generated/api';
import {type FunctionReturnType} from 'convex/server';
import {injectQueries, skipToken} from 'convex-angular';
import {AuthService} from '@/core/services/auth.service';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {BraCommunityAvatarComponent} from '@ui/components/primitives/community-avatar/community-avatar.component';
import {BraStatusBadgeComponent} from '@ui/components/primitives/status-badge/status-badge.component';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {safeResourceValue} from '@/utils/resource';

type CommunityListItem = FunctionReturnType<
  typeof api.communities.list.list
>[number];

@Component({
  selector: 'app-community-directory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ContentLayoutComponent,
    RouterLink,
    ZardSkeletonComponent,
    BraCommunityAvatarComponent,
    BraStatusBadgeComponent,
    EmptyStateComponent,
  ],
  template: `
    <app-content-layout>
      <div class="space-y-6 py-16 md:py-24">
        <div class="fade-in space-y-4">
          <p class="mono-label text-2xs text-muted-foreground">Communities</p>
          <h1
            class="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl lg:text-4xl"
          >
            find your scene
          </h1>
          <p class="max-w-2xl text-muted-foreground">
            every community running their door through braket tickets. apply,
            get vetted, get in.
          </p>
        </div>

        @if (isLoading()) {
          <div
            data-testid="community-directory-skeleton"
            class="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
          >
            @for (i of [1, 2, 3, 4, 5, 6]; track i) {
              <div
                data-testid="skeleton-card"
                class="flex flex-col gap-4 bg-card/40 p-6"
              >
                <z-skeleton zAnimation="shimmer" class="h-16 w-16 rounded-lg" />
                <div class="space-y-2">
                  <z-skeleton zAnimation="shimmer" class="h-5 w-3/4" />
                  <div class="space-y-1.5">
                    <z-skeleton zAnimation="shimmer" class="h-3 w-full" />
                    <z-skeleton zAnimation="shimmer" class="h-3 w-5/6" />
                    <z-skeleton zAnimation="shimmer" class="h-3 w-2/3" />
                  </div>
                </div>
                <z-skeleton zAnimation="shimmer" class="h-3 w-24" />
                <div class="mt-auto flex items-center justify-between gap-2">
                  <z-skeleton zAnimation="shimmer" class="h-6 w-28" />
                  <z-skeleton zAnimation="shimmer" class="h-6 w-16" />
                </div>
              </div>
            }
          </div>
        } @else if (hasLoadError()) {
          <div
            data-testid="community-directory-error-state"
            class="mx-auto flex max-w-xl flex-col items-center justify-center gap-4 py-16 text-center"
            role="alert"
            aria-live="assertive"
          >
            <div
              aria-hidden="true"
              class="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15 text-destructive-text"
            >
              <span class="font-display text-3xl font-bold">!</span>
            </div>
            <div class="space-y-2">
              <h2
                class="font-display text-2xl font-bold tracking-tight text-foreground"
              >
                directory unavailable
              </h2>
              <p class="max-w-md text-sm leading-relaxed text-muted-foreground">
                couldn&apos;t load communities right now. try again to refresh
                the directory.
              </p>
            </div>
            <button
              data-testid="community-directory-retry"
              type="button"
              (click)="retryDirectoryLoad()"
              class="inline-flex min-h-6 cursor-pointer items-center font-mono text-sm tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
            >
              ↻ try again
            </button>
          </div>
        } @else if (communities().length > 0) {
          <div
            data-testid="community-list"
            class="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
          >
            @for (
              community of communities();
              track community._id;
              let i = $index
            ) {
              @let status = statusMap().get(community._id);
              <div
                data-testid="community-card"
                class="group animate-in fade-in slide-in-from-bottom-8 flex flex-col gap-4 bg-card/40 p-6 transition-colors hover:bg-card/70"
                [style.animation-delay]="i * 75 + 'ms'"
                [style.animation-fill-mode]="'backwards'"
              >
                <a
                  data-testid="community-logo-slot"
                  [routerLink]="['/c', community.slug]"
                  [attr.aria-label]="'View ' + community.name + ' community'"
                >
                  <bra-community-avatar
                    [name]="community.name"
                    [logoUrl]="community.logoUrl"
                    size="2xl"
                    shape="rounded-lg"
                    class="transition-opacity group-hover:opacity-90"
                  />
                </a>
                <div class="space-y-2">
                  <h2
                    class="font-display text-lg font-bold tracking-wide text-foreground"
                  >
                    <a
                      data-testid="community-name-link"
                      [routerLink]="['/c', community.slug]"
                      class="transition-colors hover:text-primary"
                    >
                      {{ community.name }}
                    </a>
                  </h2>
                  @if (community.description) {
                    <p
                      data-testid="community-description"
                      class="line-clamp-3 min-h-[3.75rem] font-sans text-sm leading-relaxed text-muted-foreground"
                    >
                      {{ community.description }}
                    </p>
                  } @else {
                    <p
                      data-testid="community-description-fallback"
                      class="line-clamp-3 min-h-[3.75rem] font-sans text-sm leading-relaxed text-muted-foreground italic"
                    >
                      {{ fallbackDescription }}
                    </p>
                  }
                </div>
                @if (community.website) {
                  <p class="mono-label truncate text-xs text-muted-foreground">
                    {{ community.website }}
                  </p>
                } @else {
                  <div aria-hidden="true" class="h-[1.125rem]"></div>
                }

                <div class="mt-auto flex items-center justify-between gap-2">
                  <a
                    data-testid="cta-view-events"
                    [routerLink]="['/events']"
                    [queryParams]="{community: community.slug}"
                    [attr.aria-label]="'View events for ' + community.name"
                    class="inline-flex min-h-6 items-center gap-1 font-mono text-xs tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
                  >
                    View Events
                    <span aria-hidden="true">&rarr;</span>
                  </a>
                  @if (auth.isAuthenticated()) {
                    @if (isRelationshipLoading()) {
                      <z-skeleton
                        data-testid="community-relationship-skeleton"
                        zAnimation="shimmer"
                        class="h-6 w-16 rounded"
                      />
                    } @else if (hasRelationshipError()) {
                      <span
                        data-testid="community-relationship-error"
                        class="inline-flex min-h-6 items-center rounded bg-muted/40 px-2 py-1 font-mono text-2xs tracking-widest text-muted-foreground uppercase"
                      >
                        status unavailable
                      </span>
                    } @else if (status === 'access') {
                      <bra-status-badge
                        data-testid="status-access"
                        status="success"
                      >
                        vetted
                      </bra-status-badge>
                    } @else if (status === 'pending') {
                      <bra-status-badge
                        data-testid="status-pending"
                        status="warning"
                      >
                        pending
                      </bra-status-badge>
                    } @else if (status === 'revoked') {
                      <bra-status-badge
                        data-testid="status-revoked"
                        status="destructive"
                      >
                        revoked
                      </bra-status-badge>
                    } @else if (status === 'rejected') {
                      <div
                        class="flex flex-wrap items-center justify-end gap-2"
                      >
                        <bra-status-badge
                          data-testid="status-rejected"
                          status="destructive"
                        >
                          rejected
                        </bra-status-badge>
                        @if (community.status === 'published') {
                          <a
                            data-testid="cta-revise"
                            [routerLink]="[
                              '/vetting',
                              community.slug ?? community._id,
                            ]"
                            [attr.aria-label]="
                              'Revise application for ' + community.name
                            "
                            class="inline-flex min-h-6 items-center gap-1 font-mono text-xs tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
                          >
                            Revise
                            <span aria-hidden="true">&rarr;</span>
                          </a>
                        }
                      </div>
                    } @else {
                      <a
                        data-testid="cta-apply"
                        [routerLink]="[
                          '/vetting',
                          community.slug ?? community._id,
                        ]"
                        [attr.aria-label]="'Apply to ' + community.name"
                        class="inline-flex min-h-6 items-center gap-1 font-mono text-xs tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
                      >
                        Apply
                        <span aria-hidden="true">&rarr;</span>
                      </a>
                    }
                  }
                </div>
              </div>
            }
          </div>
        } @else {
          <app-empty-state
            data-testid="empty-state"
            title="no communities yet"
            description="nothing's listed right now — check back soon"
          >
            <a
              routerLink="/"
              data-testid="community-directory-empty-home"
              class="mt-2 inline-flex min-h-6 items-center gap-1 font-mono text-sm tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
            >
              &larr; back home
            </a>
          </app-empty-state>
        }
      </div>
    </app-content-layout>
  `,
})
export class CommunityDirectoryComponent {
  protected readonly auth = inject(AuthService);
  protected readonly fallbackDescription = 'profile coming soon';
  private readonly publicCommunitiesService = inject(PublicCommunitiesService);
  private readonly publicDirectoryAttempt = signal(0);

  // Authenticated users see all communities plus their relationship data;
  // unauthenticated users fall back to the public HTTP directory below.
  // Key order (communities -> approvals -> myApplications) is load-bearing:
  // injectQueries subscribes in Object.keys insertion order.
  private readonly queries = injectQueries(() => {
    const authed = this.auth.isAuthenticated();
    return {
      communities: authed
        ? {query: api.communities.list.list, args: {}}
        : skipToken,
      approvals: authed
        ? {query: api.communities.trust_links.getUserApprovals, args: {}}
        : skipToken,
      myApplications: authed
        ? {query: api.communities.applications.getMyApplications, args: {}}
        : skipToken,
    };
  });

  private readonly publicDirectoryResource = resource({
    params: () => ({
      isAuthenticated: this.auth.isAuthenticated(),
      attempt: this.publicDirectoryAttempt(),
    }),
    loader: async ({params}) =>
      params.isAuthenticated
        ? []
        : this.publicCommunitiesService.listDirectory(),
  });

  readonly isLoading = computed(() =>
    this.auth.isAuthenticated()
      ? this.queries.statuses().communities === 'pending'
      : this.publicDirectoryResource.isLoading(),
  );

  readonly hasLoadError = computed(() =>
    this.auth.isAuthenticated()
      ? this.queries.errors().communities != null
      : this.publicDirectoryResource.error() != null,
  );

  readonly communities = computed(() => {
    if (this.auth.isAuthenticated()) {
      const all = this.queries.results().communities ?? [];
      return all.map((c: CommunityListItem) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        website: c.website,
        logoUrl: c.logoUrl,
        status: c.status,
      }));
    }
    return safeResourceValue(this.publicDirectoryResource) ?? [];
  });

  readonly isRelationshipLoading = computed(() => {
    if (!this.auth.isAuthenticated()) return false;
    const statuses = this.queries.statuses();
    return (
      statuses.approvals === 'pending' || statuses.myApplications === 'pending'
    );
  });

  readonly hasRelationshipError = computed(() => {
    if (!this.auth.isAuthenticated()) return false;
    const errors = this.queries.errors();
    return errors.approvals != null || errors.myApplications != null;
  });

  readonly statusMap = computed(
    (): Map<string, 'access' | 'pending' | 'rejected' | 'revoked'> => {
      const map = new Map<
        string,
        'access' | 'pending' | 'rejected' | 'revoked'
      >();
      if (!this.auth.isAuthenticated()) return map;

      // getMyApplications returns newest-first (desc); track seen organizer IDs
      // so that a newer pending application is not overwritten by an older rejected one.
      const seenOrgIds = new Set<string>();
      const applications = this.queries.results().myApplications ?? [];
      for (const app of applications) {
        if (!app.organizerId) continue;
        if (seenOrgIds.has(app.organizerId)) continue;
        seenOrgIds.add(app.organizerId);
        if (
          app.status === 'pending' ||
          app.status === 'rejected' ||
          app.status === 'revoked'
        ) {
          map.set(app.organizerId, app.status);
        }
      }

      // Approvals override application status
      const approvals = this.queries.results().approvals ?? [];
      for (const approval of approvals) {
        map.set(approval.organizerId, 'access');
      }

      return map;
    },
  );

  protected retryDirectoryLoad(): void {
    if (this.auth.isAuthenticated()) {
      this.queries.refetch();
      return;
    }

    this.publicDirectoryAttempt.update((attempt) => attempt + 1);
  }
}
