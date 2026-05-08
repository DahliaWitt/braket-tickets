import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../../../core/services/auth.service';
import { type HelpArticle, type HelpCategory, type HelpSection } from '../../models/help.models';
import { buildCategory, compareCategory } from '../../services/help-manifest.service';

@Component({
  selector: 'app-help-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav>
      @if (sectionLinks().length > 1) {
        <!-- Section toggles -->
        <div class="px-4 pb-2 pt-4 flex gap-2">
          <a
            routerLink="/help/users"
            routerLinkActive="text-foreground border-primary"
            [routerLinkActiveOptions]="{ exact: false }"
            class="flex-1 text-center py-1.5 text-xs border rounded font-mono uppercase tracking-wider text-muted-foreground border-border hover:text-foreground transition-colors"
            data-testid="help-section-link"
            >User Guide</a
          >
          @if (shouldShowAdminGuide()) {
            <a
              routerLink="/help/admins"
              routerLinkActive="text-foreground border-primary"
              [routerLinkActiveOptions]="{ exact: false }"
              class="flex-1 text-center py-1.5 text-xs border rounded font-mono uppercase tracking-wider text-muted-foreground border-border hover:text-foreground transition-colors"
              data-testid="help-section-link"
              >Admin Guide</a
            >
          }
          @if (shouldShowDeveloperGuide()) {
            <a
              routerLink="/help/developers"
              routerLinkActive="text-foreground border-primary"
              [routerLinkActiveOptions]="{ exact: false }"
              class="flex-1 text-center py-1.5 text-xs border rounded font-mono uppercase tracking-wider text-muted-foreground border-border hover:text-foreground transition-colors"
              data-testid="help-section-link"
              >Developer Guide</a
            >
          }
        </div>
      }

      @for (category of activeCategories(); track category.name) {
        <div class="px-4 py-2" data-testid="help-category-group">
          <div class="flex items-center justify-between gap-1 mb-1">
            @if (category.indexArticle; as indexArticle) {
              <a
                [routerLink]="['/help/' + activeSection(), indexArticle.slug]"
                routerLinkActive="text-foreground"
                class="mono-label text-2xs text-muted-foreground hover:text-foreground transition-colors flex-1 text-left"
                data-testid="help-category-index-link"
                >{{ category.name }}</a
              >
            } @else {
              <span class="mono-label text-2xs text-muted-foreground flex-1">{{
                category.name
              }}</span>
            }
            <button
              type="button"
              (click)="toggleCategory(category.name)"
              [attr.aria-expanded]="isExpanded(category.name)"
              [attr.aria-controls]="categoryPanelId(category.name)"
              [attr.aria-label]="
                (isExpanded(category.name) ? 'Collapse ' : 'Expand ') + category.name
              "
              class="p-1 text-muted-foreground hover:text-foreground transition-colors"
              data-testid="help-category-toggle"
            >
              <span
                class="text-2xs inline-block transition-transform duration-150"
                [class.rotate-90]="isExpanded(category.name)"
                aria-hidden="true"
                >▸</span
              >
            </button>
          </div>
          @if (isExpanded(category.name)) {
            <div [id]="categoryPanelId(category.name)" data-testid="help-category-panel">
              @for (article of category.articles; track article.slug) {
                <a
                  [routerLink]="['/help/' + activeSection(), article.slug]"
                  routerLinkActive="text-foreground bg-muted"
                  class="block py-1 px-2 rounded text-sm text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="help-article-link"
                  >{{ article.title }}</a
                >
              }
            </div>
          }
        </div>
      }
    </nav>
  `,
})
export class HelpSidebarComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly articles = input.required<HelpArticle[]>();
  readonly activeSection = input.required<HelpSection>();

  private readonly collapsedCategories = signal<ReadonlySet<string>>(new Set());

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  private readonly activeCategoryName = computed<string | null>(() => {
    const url = this.currentUrl();
    const match = url.match(/\/help\/[^/]+\/([^/?#]+)/);
    if (!match) return null;
    const slug = match[1];
    const section = this.activeSection();
    const article = this.articles().find((a) => a.section === section && a.slug === slug);
    return article?.category ?? null;
  });

  readonly shouldShowAdminGuide = computed(() => {
    const role = this.auth.userRole();
    return role === 'root_admin' || role === 'community_admin';
  });

  readonly shouldShowDeveloperGuide = computed(() => {
    return this.activeSection() === 'developers';
  });

  readonly sectionLinks = computed(() => {
    const links = ['users'];
    if (this.shouldShowAdminGuide()) links.push('admins');
    if (this.shouldShowDeveloperGuide()) links.push('developers');
    return links;
  });

  readonly activeCategories = computed<HelpCategory[]>(() => {
    const section = this.activeSection();
    return this.groupByCategory(this.articles().filter((a) => a.section === section));
  });

  isExpanded(name: string): boolean {
    if (this.activeCategoryName() === name) return true;
    return !this.collapsedCategories().has(name);
  }

  categoryPanelId(name: string): string {
    return 'help-category-' + name.replace(/\s+/g, '-').toLowerCase();
  }

  toggleCategory(name: string): void {
    const next = new Set(this.collapsedCategories());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.collapsedCategories.set(next);
  }

  private groupByCategory(articles: HelpArticle[]): HelpCategory[] {
    const categoryMap = new Map<string, HelpArticle[]>();
    for (const article of articles) {
      const existing = categoryMap.get(article.category) ?? [];
      existing.push(article);
      categoryMap.set(article.category, existing);
    }
    return Array.from(categoryMap.entries())
      .map(([name, items]) => buildCategory(name, items))
      .toSorted(compareCategory);
  }
}
