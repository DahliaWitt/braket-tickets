import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type HelpSection, type HelpCategory } from '../../models/help.models';
import { HelpManifestService } from '../../services/help-manifest.service';

@Component({
  selector: 'app-section-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="font-sans">
      <h1 class="text-3xl font-display font-bold mb-2">
        {{ sectionLabel() }}
      </h1>
      <p class="text-muted-foreground mb-8">
        {{ sectionDescription() }}
      </p>

      @if (section() === 'developers') {
        <section class="mb-8">
          <h2
            class="mono-label text-2xs text-muted-foreground mb-3 border-b border-border pb-2"
          >
            Overview
          </h2>
          <div class="aspect-video max-w-2xl rounded overflow-hidden border border-border">
            <iframe
              width="560"
              height="315"
              src="https://www.youtube-nocookie.com/embed/Vhh_GeBPOhs?si=aAK4wGt43OXGfgz8"
              title="YouTube video player"
              frameborder="0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerpolicy="strict-origin-when-cross-origin"
              allowfullscreen
              class="w-full h-full"
            ></iframe>
          </div>
        </section>
      }

      @for (category of categories(); track category.name) {
        <section class="mb-8">
          <h2
            class="mono-label text-2xs text-muted-foreground mb-3 border-b border-border pb-2"
          >
            @if (category.indexArticle; as indexArticle) {
              <a
                [routerLink]="['/help', section(), indexArticle.slug]"
                class="hover:text-foreground transition-colors"
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
                class="block rounded border border-border p-4 hover:border-primary hover:bg-muted transition-colors group"
                data-testid="help-article-card"
              >
                <h3
                  class="font-semibold text-foreground group-hover:text-primary mb-1 transition-colors"
                >
                  {{ article.title }}
                </h3>
                <p class="text-sm text-muted-foreground">{{ article.description }}</p>
              </a>
            }
          </div>
        </section>
      } @empty {
        <p class="text-muted-foreground">No articles available in this section.</p>
      }
    </div>
  `,
})
export class SectionLandingComponent {
  readonly section = input.required<HelpSection>();

  private readonly manifest = inject(HelpManifestService);

  readonly sectionLabel = computed(() => {
    const s = this.section();
    switch (s) {
      case 'users':
        return 'User Guide';
      case 'admins':
        return 'Admin Guide';
      case 'developers':
        return 'Developer Guide';
      default:
        return s;
    }
  });

  readonly sectionDescription = computed(() => {
    const s = this.section();
    switch (s) {
      case 'users':
        return 'Everything you need to get started and make the most of the platform.';
      case 'admins':
        return 'Tools and guides for community administrators and organizers.';
      case 'developers':
        return 'Technical documentation for contributors working on Braket Tickets.';
      default:
        return '';
    }
  });

  readonly categories = computed<HelpCategory[]>(() =>
    this.manifest.getCategoriesForSection(this.section()),
  );
}
