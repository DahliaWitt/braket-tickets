import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
} from '@angular/core';
import {RouterLink} from '@angular/router';
import {type HelpSection, type HelpCategory} from '../../models/help.models';
import {HelpManifestService} from '../../services/help-manifest.service';
import {EmptyStateComponent} from '@ui/components/primitives/empty-state/empty-state.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';

@Component({
  selector: 'app-section-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EmptyStateComponent, ZardSkeletonComponent],
  template: `
    <div class="font-sans">
      <h1
        class="mb-2 font-display text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl"
      >
        {{ sectionLabel() }}
      </h1>
      <p class="mb-8 text-muted-foreground">
        {{ sectionDescription() }}
      </p>

      @if (section() === 'developers') {
        <section class="mb-8">
          <h2
            class="mono-label mb-3 border-b border-border pb-2 text-2xs text-muted-foreground"
          >
            Overview
          </h2>
          <div
            class="aspect-video max-w-2xl overflow-hidden rounded border border-border"
          >
            <iframe
              src="https://www.youtube-nocookie.com/embed/Vhh_GeBPOhs?si=aAK4wGt43OXGfgz8"
              title="Braket Tickets developer onboarding overview"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerpolicy="strict-origin-when-cross-origin"
              allowfullscreen
              class="h-full w-full"
            ></iframe>
          </div>
        </section>
      }

      @if (manifestFailed()) {
        <div
          class="animate-in fade-in mx-auto flex w-full max-w-xl flex-col items-center justify-center py-16 text-center duration-500"
          data-testid="section-error-state"
          role="alert"
        >
          <div
            class="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/20"
          >
            <span class="text-4xl text-destructive-text" aria-hidden="true"
              >!</span
            >
          </div>
          <h2
            class="mb-4 font-display text-2xl font-bold tracking-tight text-destructive-text uppercase"
          >
            hit a snag
          </h2>
          <p class="font-sans text-lg text-muted-foreground">
            couldn't load articles — try refreshing
          </p>
        </div>
      } @else if (!manifestLoaded()) {
        <div
          class="grid gap-4 sm:grid-cols-2"
          data-testid="section-loading-state"
          aria-hidden="true"
        >
          @for (i of skeletonTiles; track i) {
            <div class="rounded bg-card p-4">
              <z-skeleton class="mb-2 h-5 w-2/3" />
              <z-skeleton class="h-4 w-full" />
            </div>
          }
        </div>
      } @else {
        @for (category of categories(); track category.name) {
          <section class="mb-8">
            <h2
              class="mono-label mb-3 border-b border-border pb-2 text-2xs text-muted-foreground"
            >
              @if (category.indexArticle; as indexArticle) {
                <a
                  [routerLink]="['/help', section(), indexArticle.slug]"
                  class="transition-colors hover:text-foreground"
                  data-testid="help-category-index-link"
                  >{{ category.name }}</a
                >
              } @else {
                {{ category.name }}
              }
            </h2>
            <div class="grid gap-4 sm:grid-cols-2">
              @for (article of category.articles; track article.slug) {
                <a
                  [routerLink]="['/help', section(), article.slug]"
                  class="group block rounded border border-transparent bg-card p-4 transition-colors hover:border-primary focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none"
                  data-testid="help-article-card"
                >
                  <h3
                    class="mb-1 font-semibold text-foreground transition-colors group-hover:text-primary"
                  >
                    {{ article.title }}
                  </h3>
                  <p class="text-sm text-muted-foreground">
                    {{ article.description }}
                  </p>
                </a>
              }
            </div>
          </section>
        } @empty {
          <app-empty-state
            data-testid="section-empty-state"
            title="nothing here yet"
            description="no articles in this section yet — check back soon"
            isStatus
          />
        }
      }
    </div>
  `,
})
export class SectionLandingComponent {
  readonly section = input.required<HelpSection>();

  private readonly manifest = inject(HelpManifestService);

  protected readonly skeletonTiles = [0, 1, 2, 3];

  readonly manifestLoaded = computed(() => this.manifest.isLoaded());
  readonly manifestFailed = computed(() => this.manifest.loadFailed());

  readonly sectionLabel = computed(() => {
    const s = this.section();
    switch (s) {
      case 'users':
        return 'user guide';
      case 'admins':
        return 'admin guide';
      case 'developers':
        return 'developer guide';
      default:
        return s;
    }
  });

  readonly sectionDescription = computed(() => {
    const s = this.section();
    switch (s) {
      case 'users':
        return 'everything you need to get started and make the most of the platform.';
      case 'admins':
        return 'tools and guides for community administrators and organizers.';
      case 'developers':
        return 'technical documentation for contributors working on Braket Tickets.';
      default:
        return '';
    }
  });

  readonly categories = computed<HelpCategory[]>(() =>
    this.manifest.getCategoriesForSection(this.section()),
  );
}
