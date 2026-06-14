import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  effect,
  input,
  resource,
  signal,
  untracked,
} from '@angular/core';
import {NgOptimizedImage} from '@angular/common';
import {AuthService} from '@/core/services/auth.service';
import {PublicCommunitiesService} from '@/core/services/public-communities.service';
import {PublicEventsService} from '@/core/services/public-events.service';
import {Router, RouterLink} from '@angular/router';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {BraCommunityAvatarComponent} from '@ui/components/primitives/community-avatar/community-avatar.component';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';
import type {PublicEventCard} from '@shared/contracts/public-event';
import {getBuyerPricingSummary} from '@shared/pricing/pricing-summary';
import {EventDatePipe} from '@/utils/event-date.pipe';

@Component({
  selector: 'app-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ContentLayoutComponent,
    EventDatePipe,
    NgOptimizedImage,
    BraCommunityAvatarComponent,
  ],
  template: `
    <app-content-layout>
      <div
        class="flex min-w-0 grow flex-col"
        [class.justify-center]="shouldCenter()"
      >
        <!-- Hero -->
        <section data-testid="landing-hero" class="fade-in py-8 md:py-12">
          <div class="flex items-start justify-between">
            <h1 class="font-display tracking-tight text-foreground">
              <span
                class="mono-label mb-2 block text-2xs text-muted-foreground"
              >
                vetting & tickets for
              </span>
              <span
                class="block text-4xl leading-[0.9] font-bold sm:text-5xl lg:text-6xl"
              >
                sacred spaces
              </span>
            </h1>
            <span
              data-testid="landing-iykyk"
              class="hidden font-display text-5xl leading-none font-bold text-foreground/[0.06] select-none sm:block md:text-6xl lg:text-7xl"
              aria-hidden="true"
            >
              iykyk
            </span>
          </div>
          <div class="mt-6">
            <button
              type="button"
              (click)="login()"
              data-testid="landing-login-btn"
              class="focus-ring border-2 border-primary px-8 py-3 font-mono text-2xs tracking-widest text-foreground uppercase transition-colors hover:bg-primary hover:text-white"
              aria-label="Navigate to login page"
            >
              Log In / Sign Up
            </button>
          </div>
        </section>

        <!-- Events -->
        @if (visibleEvents().length > 0) {
          <section
            data-testid="landing-events"
            class="fade-in fade-in-delay-1 border-t border-border"
          >
            <div class="flex items-center justify-between px-1 py-3">
              <p class="mono-label text-2xs text-muted-foreground">
                Upcoming Events
              </p>
              @if (showBrowseAll()) {
                <a
                  routerLink="/events"
                  data-testid="browse-all-events"
                  class="font-mono text-2xs tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
                >
                  Browse All →
                </a>
              }
            </div>
            <div class="border-t border-border">
              @for (
                event of visibleEvents();
                track event._id;
                let first = $first
              ) {
                <a
                  [routerLink]="['/events', event._id]"
                  class="focus-ring grid grid-cols-1 border-b border-border transition-colors last:border-b-0 hover:bg-foreground/[0.02] md:grid-cols-[auto_1fr]"
                  [attr.aria-label]="'View details for ' + event.title"
                >
                  @if (event.posterUrl) {
                    <div
                      class="relative h-64 w-full overflow-hidden bg-card md:h-56 md:w-48 lg:w-56"
                    >
                      <img
                        [ngSrc]="event.posterUrl"
                        [alt]="event.title + ' event poster'"
                        fill
                        [priority]="first"
                        ngSrcset="320w, 640w, 1024w"
                        sizes="(min-width: 1024px) 224px, (min-width: 768px) 192px, 100vw"
                        class="object-contain"
                      />
                    </div>
                  }
                  <div
                    class="space-y-2 px-5 py-5 md:px-6 md:py-6"
                    [class.border-l-2]="!event.posterUrl"
                    [class.border-l-primary/30]="!event.posterUrl"
                  >
                    <h2
                      class="line-clamp-2 font-display text-xl font-bold tracking-tight text-foreground uppercase md:text-2xl"
                    >
                      {{ event.title }}
                    </h2>
                    <p class="mono-label text-2xs text-muted-foreground">
                      {{ event.date | eventDate: 'mediumDate' }},
                      {{ event.date | eventDate: 'shortTime' }}
                      @if (event.location) {
                        <span> · {{ event.location }}</span>
                      }
                      ·
                      {{ priceSummary(event).primaryText }}
                      ·
                      <span class="text-primary">View Event →</span>
                    </p>
                    @if (event.description) {
                      <p
                        class="line-clamp-2 max-w-prose text-sm leading-relaxed text-muted-foreground"
                      >
                        {{ event.description }}
                      </p>
                    }
                  </div>
                </a>
              }
            </div>
          </section>
        }

        <!-- Communities Bar -->
        @if (publicCommunities().length > 0) {
          <section
            data-testid="landing-communities"
            class="no-scrollbar fade-in fade-in-delay-3 flex items-center gap-6 overflow-x-auto border-t border-border py-5"
          >
            <p class="mono-label flex-shrink-0 text-2xs text-muted-foreground">
              Communities
            </p>
            <div class="no-scrollbar flex flex-1 gap-4 overflow-x-auto">
              @for (community of publicCommunities(); track community._id) {
                <a
                  [routerLink]="
                    community.slug
                      ? ['/communities', community.slug]
                      : ['/communities']
                  "
                  class="flex flex-shrink-0 items-center gap-1.5 transition-colors hover:text-primary"
                  [attr.aria-label]="'View ' + community.name + ' community'"
                >
                  <bra-community-avatar
                    [name]="community.name"
                    [logoUrl]="community.logoUrl"
                    size="xs"
                  />
                  <span
                    class="max-w-[10rem] truncate font-display text-sm font-bold text-foreground"
                  >
                    {{ community.name }}
                  </span>
                </a>
              }
            </div>
            <a
              routerLink="/communities"
              class="flex-shrink-0 font-mono text-2xs tracking-widest text-primary uppercase transition-colors hover:text-primary/80"
            >
              All →
            </a>
          </section>
        }
      </div>
    </app-content-layout>
  `,
})
export class LandingComponent {
  auth = inject(AuthService);
  router = inject(Router);
  private readonly publicCommunitiesService = inject(PublicCommunitiesService);
  private readonly publicEventsService = inject(PublicEventsService);
  private readonly ottHandled = signal(false);

  readonly ott = input<string | undefined>();

  private readonly publicCommunitiesResource = resource({
    params: () => ({}),
    loader: async () => this.publicCommunitiesService.listDirectory(),
  });
  readonly publicCommunities = computed(
    () => safeResourceValue(this.publicCommunitiesResource) ?? [],
  );

  private readonly publicEventsResource = resource({
    params: () => ({}),
    loader: async () => this.publicEventsService.listUpcoming(),
  });
  readonly publicEvents = computed(
    () => safeResourceValue(this.publicEventsResource) ?? [],
  );

  readonly visibleEvents = computed(() => this.publicEvents().slice(0, 4));
  readonly showBrowseAll = computed(() => this.publicEvents().length > 4);
  readonly shouldCenter = computed(() => this.publicEvents().length === 0);

  constructor() {
    effect(() => {
      const ott = this.ott();
      if (!ott || untracked(() => this.ottHandled())) {
        return;
      }

      this.ottHandled.set(true);
      void this.handleOttRedirect(ott);
    });
  }

  private async handleOttRedirect(ott: string): Promise<void> {
    // Handle OTT (one-time token) from crossDomain OAuth redirect
    // This is a fallback in case crossDomain plugin redirects to root instead of /login
    logger.info('[LandingComponent] OTT detected, forwarding to auth service');
    try {
      await this.auth.handleOAuthCallback(ott);
      // handleOAuthCallback navigates to / on success
    } catch (err) {
      logger.error('[LandingComponent] OTT handling failed:', err);
      // Clear the OTT param and let user try logging in manually
      void this.router.navigate(['/login'], {
        queryParams: {
          error: err instanceof Error ? err.message : 'Authentication failed',
        },
      });
    }
  }

  login() {
    void this.router.navigate(['/login']);
  }

  priceSummary(event: PublicEventCard) {
    return getBuyerPricingSummary({
      ...event,
      canSeePrice:
        event.visibility !== 'public_viewable' || this.auth.isAuthenticated(),
    });
  }
}
