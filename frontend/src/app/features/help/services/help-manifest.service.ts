import {Injectable, computed, inject, signal} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {firstValueFrom} from 'rxjs';
import {
  type HelpArticle,
  type HelpCategory,
  type HelpSection,
  type HelpAccessLevel,
} from '../models/help.models';

export function buildCategory(
  name: string,
  items: HelpArticle[],
): HelpCategory {
  const indexArticle = items.find((a) => a.isCategoryIndex);
  const rest = items.filter((a) => !a.isCategoryIndex);
  const orders = items
    .map((a) => a.categoryOrder)
    .filter((n): n is number => typeof n === 'number');
  const order =
    orders.length > 0 ? Math.min(...orders) : Number.POSITIVE_INFINITY;
  return {
    name,
    indexArticle,
    order,
    articles: rest.toSorted((a, b) => a.order - b.order),
  };
}

export function compareCategory(a: HelpCategory, b: HelpCategory): number {
  if (a.order !== b.order) return a.order - b.order;
  return a.name.localeCompare(b.name);
}

type UserRole = 'root_admin' | 'community_admin' | 'user' | undefined;

const SECTION_DEFAULT_ACCESS: Record<HelpSection, HelpAccessLevel> = {
  users: 'public',
  admins: 'community_admin',
  developers: 'public',
};

const ACCESS_HIERARCHY: Record<HelpAccessLevel, (role: UserRole) => boolean> = {
  public: () => true,
  authenticated: (role) => role !== undefined,
  community_admin: (role) =>
    role === 'community_admin' || role === 'root_admin',
  root_admin: (role) => role === 'root_admin',
};

@Injectable()
export class HelpManifestService {
  private readonly http = inject(HttpClient);
  private manifestPromise: Promise<HelpArticle[]> | null = null;
  private readonly articles = signal<HelpArticle[] | null>(null);
  private readonly loadFailedSignal = signal(false);

  /** True once the manifest has loaded successfully. */
  readonly isLoaded = computed(() => this.articles() !== null);
  /** True when the most recent manifest load attempt failed. */
  readonly loadFailed = this.loadFailedSignal.asReadonly();

  loadManifest(): Promise<HelpArticle[]> {
    if (this.manifestPromise) return this.manifestPromise;
    this.loadFailedSignal.set(false);
    this.manifestPromise = firstValueFrom(
      this.http.get<HelpArticle[]>('/docs/manifest.json'),
    )
      .then((articles) => {
        this.articles.set(articles);
        return articles;
      })
      .catch((error: unknown) => {
        this.manifestPromise = null;
        this.loadFailedSignal.set(true);
        throw error;
      });
    return this.manifestPromise;
  }

  getArticlesBySection(section: HelpSection): HelpArticle[] {
    return (this.articles() ?? []).filter((a) => a.section === section);
  }

  getCategoriesForSection(section: HelpSection): HelpCategory[] {
    const articles = this.getArticlesBySection(section);
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

  getArticle(section: HelpSection, slug: string): HelpArticle | undefined {
    return (this.articles() ?? []).find(
      (a) => a.section === section && a.slug === slug,
    );
  }

  getArticleAccess(article: HelpArticle): HelpAccessLevel {
    return article.access ?? SECTION_DEFAULT_ACCESS[article.section];
  }

  getAccessibleArticles(userRole: UserRole): HelpArticle[] {
    return (this.articles() ?? []).filter((a) => {
      const access = this.getArticleAccess(a);
      return ACCESS_HIERARCHY[access](userRole);
    });
  }

  canAccess(article: HelpArticle, userRole: UserRole): boolean {
    const access = this.getArticleAccess(article);
    return ACCESS_HIERARCHY[access](userRole);
  }
}
