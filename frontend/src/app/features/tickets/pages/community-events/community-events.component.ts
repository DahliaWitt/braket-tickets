import {
  Component,
  inject,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {toSignal} from '@angular/core/rxjs-interop';
import {RouterLink} from '@angular/router';
import {ActivatedRoute} from '@angular/router';
import {map} from 'rxjs';
import {injectQuery, skipToken} from 'convex-angular';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {EventCardComponent} from '@ui/components/composites/event-card/event-card.component';
import {BraCommunityAvatarComponent} from '@ui/components/primitives/community-avatar/community-avatar.component';
import {BraCodeOfConductLinkComponent} from '@ui/components/primitives/code-of-conduct-link/code-of-conduct-link.component';
import {api} from '@convex/_generated/api';
import {queryLoadState} from '@/utils/resource';

@Component({
  selector: 'app-community-events',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ZardButtonComponent,
    ZardIconComponent,
    ZardSkeletonComponent,
    EmptyStateComponent,
    EventCardComponent,
    BraCommunityAvatarComponent,
    BraCodeOfConductLinkComponent,
  ],
  template: `
    <main
      data-testid="community-events-page"
      class="bg-waterfall relative grid grow grid-cols-1 md:grid-cols-[1fr_minmax(auto,64rem)_1fr]"
    >
      <!-- Left Column -->
      <div
        class="relative hidden overflow-hidden border-r border-border md:block"
      ></div>

      <!-- Center Column -->
      <div class="relative z-10 flex flex-col bg-background px-6 py-10">
        @switch (pageState()) {
          @case ('no-community') {
            <div data-testid="community-events-picker" class="py-8">
              <h1
                class="animate-in fade-in slide-in-from-left-4 mb-2 flex items-center gap-4 font-display text-2xl font-bold tracking-tight text-foreground uppercase duration-500 sm:text-3xl lg:text-4xl"
              >
                Events
                <span class="h-px grow bg-border"></span>
              </h1>
              <p class="mb-10 max-w-lg font-sans text-muted-foreground">
                Pick a community to see their upcoming events.
              </p>

              @if (publicCommunities().length > 0) {
                <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  @for (
                    community of publicCommunities();
                    track community._id;
                    let i = $index
                  ) {
                    <a
                      data-testid="community-picker-card"
                      [routerLink]="['/events']"
                      [queryParams]="{community: community._id}"
                      class="group animate-in fade-in slide-in-from-bottom-8 space-y-4 rounded-xl border border-border bg-card p-6 transition-[transform,border-color] duration-300 hover:border-primary/60 motion-safe:hover:scale-[1.01]"
                      [style.animation-delay]="i * 75 + 'ms'"
                      [style.animation-fill-mode]="'backwards'"
                      [attr.aria-label]="'View events for ' + community.name"
                    >
                      <bra-community-avatar
                        [name]="community.name"
                        [logoUrl]="community.logoUrl"
                        size="xl"
                        shape="rounded-lg"
                      />
                      <div class="space-y-1">
                        <h2
                          class="font-display text-lg font-bold tracking-wide text-foreground transition-colors group-hover:text-primary"
                        >
                          {{ community.name }}
                        </h2>
                        @if (community.description) {
                          <p
                            class="line-clamp-2 font-sans text-sm leading-relaxed text-muted-foreground/80"
                          >
                            {{ community.description }}
                          </p>
                        }
                      </div>
                      <span
                        class="inline-flex items-center gap-1 font-mono text-xs tracking-widest text-primary/70 uppercase transition-colors group-hover:text-primary"
                      >
                        View Events <span aria-hidden="true">&rarr;</span>
                      </span>
                    </a>
                  }
                </div>
              } @else {
                <app-empty-state
                  data-testid="community-picker-empty"
                  title="no communities yet"
                  description="nothing's listed right now — check back soon"
                >
                  <a
                    routerLink="/"
                    data-testid="community-picker-empty-home"
                    class="mt-2 inline-flex min-h-6 items-center gap-1 font-mono text-xs tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
                  >
                    &larr; back home
                  </a>
                </app-empty-state>
              }
            </div>
          }

          @case ('error') {
            <div
              data-testid="community-events-error"
              class="flex flex-col items-center justify-center gap-4 py-20"
            >
              <z-icon
                zType="circle-alert"
                class="h-12 w-12 text-destructive-text"
              />
              <h1
                class="font-display text-2xl font-bold tracking-tight text-destructive-text uppercase"
              >
                Community Not Found
              </h1>
              <p class="max-w-sm text-center font-sans text-muted-foreground">
                The community you're looking for doesn't exist or the link may
                be invalid.
              </p>
              <z-button zType="outline" routerLink="/">Back to Home</z-button>
            </div>
          }

          @case ('loading') {
            <!-- Loading skeleton header -->
            <div class="mb-6 flex items-start justify-between gap-4">
              <z-skeleton class="h-10 w-64" />
            </div>
            <div class="grid gap-6 md:grid-cols-2">
              <div
                class="h-[400px] overflow-hidden rounded-xl border border-border bg-card"
              >
                <z-skeleton class="h-1/2 w-full rounded-none" />
                <div class="space-y-4 p-6">
                  <z-skeleton class="h-8 w-3/4" />
                  <div class="flex justify-between">
                    <z-skeleton class="h-4 w-24" />
                    <z-skeleton class="h-4 w-32" />
                  </div>
                  <z-skeleton class="h-20 w-full" />
                  <div class="flex gap-4 border-t border-border pt-4">
                    <z-skeleton class="h-10 flex-1" />
                    <z-skeleton class="h-10 flex-1" />
                  </div>
                </div>
              </div>
              <div
                class="hidden h-[400px] overflow-hidden rounded-xl border border-border bg-card md:block"
              >
                <z-skeleton class="h-1/2 w-full rounded-none" />
                <div class="space-y-4 p-6">
                  <z-skeleton class="h-8 w-3/4" />
                  <div class="flex justify-between">
                    <z-skeleton class="h-4 w-24" />
                    <z-skeleton class="h-4 w-32" />
                  </div>
                  <z-skeleton class="h-20 w-full" />
                  <div class="flex gap-4 border-t border-border pt-4">
                    <z-skeleton class="h-10 flex-1" />
                    <z-skeleton class="h-10 flex-1" />
                  </div>
                </div>
              </div>
            </div>
          }

          @case ('empty') {
            <h1
              data-testid="community-events-header"
              class="animate-in fade-in slide-in-from-left-4 flex items-center gap-4 font-display text-2xl font-bold tracking-tight text-foreground uppercase duration-500 sm:text-3xl lg:text-4xl"
              [class.mb-2]="organizerDescription() || organizerCodeOfConduct()"
              [class.mb-6]="
                !organizerDescription() && !organizerCodeOfConduct()
              "
            >
              @if (organizerLogoUrl()) {
                <bra-community-avatar
                  [name]="organizerName()"
                  [logoUrl]="organizerLogoUrl()"
                  size="xl"
                  shape="rounded-lg"
                />
              }
              {{ organizerName() }}
              <span class="h-px grow bg-border"></span>
            </h1>
            @if (organizerDescription()) {
              <p
                data-testid="community-events-description"
                class="animate-in fade-in slide-in-from-left-4 max-w-2xl font-sans text-muted-foreground duration-500"
                [class.mb-3]="organizerCodeOfConduct()"
                [class.mb-8]="!organizerCodeOfConduct()"
              >
                {{ organizerDescription() }}
              </p>
            }
            @if (organizerCodeOfConduct(); as coc) {
              <div
                class="animate-in fade-in slide-in-from-left-4 mb-8 duration-500"
                data-testid="community-coc-link"
              >
                <bra-code-of-conduct-link [codeOfConduct]="coc" />
              </div>
            }
            <div data-testid="community-events-empty">
              <app-empty-state
                title="no upcoming events"
                description="nothing on the calendar yet — check back soon"
              >
                <a
                  routerLink="/events"
                  data-testid="community-events-empty-browse"
                  class="mt-2 inline-flex min-h-6 items-center gap-1 font-mono text-xs tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
                >
                  browse other communities
                  <span aria-hidden="true">&rarr;</span>
                </a>
              </app-empty-state>
            </div>
          }

          @case ('loaded') {
            <h1
              data-testid="community-events-header"
              class="animate-in fade-in slide-in-from-left-4 flex items-center gap-4 font-display text-2xl font-bold tracking-tight text-foreground uppercase duration-500 sm:text-3xl lg:text-4xl"
              [class.mb-2]="organizerDescription() || organizerCodeOfConduct()"
              [class.mb-6]="
                !organizerDescription() && !organizerCodeOfConduct()
              "
            >
              @if (organizerLogoUrl()) {
                <bra-community-avatar
                  [name]="organizerName()"
                  [logoUrl]="organizerLogoUrl()"
                  size="xl"
                  shape="rounded-lg"
                />
              }
              {{ organizerName() }}
              <span class="hidden h-px grow bg-border sm:block"></span>
            </h1>
            @if (organizerDescription()) {
              <p
                data-testid="community-events-description"
                class="animate-in fade-in slide-in-from-left-4 max-w-2xl font-sans text-muted-foreground duration-500"
                [class.mb-3]="organizerCodeOfConduct()"
                [class.mb-8]="!organizerCodeOfConduct()"
              >
                {{ organizerDescription() }}
              </p>
            }
            @if (organizerCodeOfConduct(); as coc) {
              <div
                class="animate-in fade-in slide-in-from-left-4 mb-8 duration-500"
                data-testid="community-coc-link"
              >
                <bra-code-of-conduct-link [codeOfConduct]="coc" />
              </div>
            }

            <div
              data-testid="community-events-grid"
              class="grid gap-6 md:grid-cols-2"
            >
              @for (event of events(); track event._id; let i = $index) {
                <app-event-card
                  data-testid="community-event-card"
                  [event]="event"
                  [priority]="i < 2"
                  class="animate-in fade-in slide-in-from-bottom-8"
                  [style.animation-delay]="i * 75 + 75 + 'ms'"
                  [style.animation-fill-mode]="'backwards'"
                />
              }
            </div>
          }
        }
      </div>

      <!-- Right Column -->
      <div
        class="relative hidden overflow-hidden border-l border-border md:block"
      ></div>
    </main>
  `,
})
export class CommunityEventsComponent {
  private readonly route = inject(ActivatedRoute);

  /** Slug from the route path param (e.g. /c/:slug or /communities/:slug). */
  private readonly routeSlug = toSignal(
    this.route.paramMap.pipe(map((params) => params.get('slug'))),
    {initialValue: null},
  );

  /** The raw `?community=<value>` query param value, or null if absent. Reactive to URL changes. */
  private readonly queryParam = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('community'))),
    {initialValue: null},
  );

  /** Combined community param: route slug takes precedence over query param. */
  readonly communityParam = computed(
    () => this.routeSlug() ?? this.queryParam(),
  );

  private readonly query = injectQuery(
    api.events.public.listByOrganizer,
    () => {
      const param = this.communityParam();
      if (!param) return skipToken;

      return {communityParam: param};
    },
  );

  /** Events directory — skipped when a community is already selected. */
  private readonly directoryQuery = injectQuery(
    api.communities.directory.listEventsDirectory,
    () => (this.communityParam() === null ? {} : skipToken),
  );

  readonly publicCommunities = computed(() => this.directoryQuery.data() ?? []);

  readonly isLoading = this.query.isLoading;
  readonly isSkipped = this.query.isSkipped;
  readonly queryData = this.query.data;
  readonly queryState = computed(() => queryLoadState(this.query));

  readonly organizerName = computed(
    () => this.queryData()?.organizerName ?? '',
  );
  readonly organizerDescription = computed(
    () => this.queryData()?.organizerDescription ?? '',
  );
  readonly organizerLogoUrl = computed(
    () => this.queryData()?.organizerLogoUrl,
  );
  readonly organizerCodeOfConduct = computed(
    () => this.queryData()?.organizerCodeOfConduct,
  );
  readonly events = computed(() => this.queryData()?.events ?? []);

  /**
   * Derive the page state from query signals for clean @switch in the template.
   * 'no-community' — no community param; show community picker
   * 'loading'      — query is in flight
   * 'error'        — query returned null (unknown/inaccessible organizer)
   * 'empty'        — query succeeded but organizer has no events
   * 'loaded'       — query succeeded with events
   */
  readonly pageState = computed<
    'no-community' | 'error' | 'loading' | 'empty' | 'loaded'
  >(() => {
    if (this.communityParam() === null) return 'no-community';
    const state = this.queryState();
    if (state === 'idle' || state === 'error') return 'error';
    if (state === 'loading') return 'loading';
    if (this.queryData() === null) return 'error';
    const evts = this.events();
    return evts.length === 0 ? 'empty' : 'loaded';
  });
}
