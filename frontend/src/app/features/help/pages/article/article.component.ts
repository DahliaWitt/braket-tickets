import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  input,
  resource,
  viewChild,
} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {RouterLink} from '@angular/router';
import {firstValueFrom} from 'rxjs';
import {MarkdownComponent} from 'ngx-markdown';
import {type HelpSection, type HelpArticle} from '../../models/help.models';
import {HelpManifestService} from '../../services/help-manifest.service';
import {AuthService} from '@/core/services/auth.service';
import {highlightArticleCode} from './article-highlighter';
import {safeResourceValue} from '@/utils/resource';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardSkeletonComponent} from '@ui/components/primitives/skeleton/skeleton.component';

@Component({
  selector: 'app-article',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MarkdownComponent,
    ZardIconComponent,
    ZardButtonComponent,
    ZardSkeletonComponent,
  ],
  template: `
    <!-- Breadcrumb -->
    <nav
      aria-label="Breadcrumb"
      data-testid="help-breadcrumb"
      class="mb-6 flex items-center gap-2 text-sm text-muted-foreground"
    >
      <a routerLink="/help" class="transition-colors hover:text-foreground"
        >help</a
      >
      <span>/</span>
      <a
        [routerLink]="['/help', section()]"
        class="transition-colors hover:text-foreground"
      >
        {{ sectionLabel() }}
      </a>
      @if (article()) {
        <span>/</span>
        <span class="text-foreground" aria-current="page">{{
          article()!.title
        }}</span>
      }
    </nav>

    @if (hasLoadError()) {
      <div
        class="animate-in fade-in zoom-in mx-auto flex w-full max-w-xl flex-col items-center justify-center py-16 text-center duration-500"
        data-testid="article-error-state"
        role="alert"
        aria-live="assertive"
      >
        <div
          class="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-destructive/20"
        >
          <span class="text-4xl text-destructive-text" aria-hidden="true"
            >!</span
          >
        </div>
        <h2
          class="mb-4 font-display text-2xl font-bold tracking-tight text-destructive-text uppercase md:text-3xl"
        >
          hit a snag
        </h2>
        <p class="mb-8 font-sans text-lg text-muted-foreground">
          couldn't load this article — try again later
        </p>
        <a
          routerLink="/help"
          class="font-mono text-sm tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
        >
          back to help center
        </a>
      </div>
    } @else if (article()) {
      @if (canAccess()) {
        <article
          data-testid="help-article-content"
          class="prose max-w-none font-sans dark:prose-invert prose-headings:font-display prose-h1:text-3xl prose-h1:font-bold prose-h2:text-xl prose-h3:text-lg prose-p:text-muted-foreground prose-a:text-primary prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-border prose-pre:bg-card"
        >
          @if (markdownContent.isLoading()) {
            <div
              class="not-prose space-y-4"
              data-testid="article-loading-state"
              aria-hidden="true"
            >
              <z-skeleton class="h-9 w-2/3" />
              <div class="space-y-2 pt-4">
                <z-skeleton class="h-4 w-full" />
                <z-skeleton class="h-4 w-11/12" />
                <z-skeleton class="h-4 w-4/5" />
              </div>
              <div class="space-y-2 pt-4">
                <z-skeleton class="h-4 w-full" />
                <z-skeleton class="h-4 w-3/4" />
              </div>
            </div>
          } @else if (markdownContentValue(); as md) {
            <markdown [data]="md" (ready)="enhanceMarkdown()" />
          }
        </article>

        <!-- Prev/Next navigation -->
        @if (prevArticle() || nextArticle()) {
          <nav class="mt-12 flex gap-4 border-t border-border pt-6">
            @if (prevArticle()) {
              <a
                [routerLink]="['/help', section(), prevArticle()!.slug]"
                class="group flex min-w-0 flex-auto items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                data-testid="prev-article-link"
              >
                <span
                  aria-hidden="true"
                  class="grid shrink-0 place-items-center self-stretch"
                  data-testid="prev-article-icon-wrapper"
                >
                  <z-icon
                    zType="arrow-left"
                    class="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
                  />
                </span>
                <span class="flex min-w-0 flex-col gap-1">
                  <span class="font-mono text-2xs tracking-widest uppercase"
                    >previous</span
                  >
                  <span
                    class="line-clamp-2 max-w-full leading-snug font-medium break-words whitespace-normal"
                    data-testid="prev-article-title"
                  >
                    {{ prevArticle()!.title }}
                  </span>
                </span>
              </a>
            }

            @if (nextArticle()) {
              <a
                [routerLink]="['/help', section(), nextArticle()!.slug]"
                class="group flex min-w-0 flex-auto items-center justify-end gap-3 text-right text-sm text-muted-foreground transition-colors hover:text-foreground"
                data-testid="next-article-link"
              >
                <span class="flex min-w-0 flex-col gap-1">
                  <span class="font-mono text-2xs tracking-widest uppercase"
                    >next</span
                  >
                  <span
                    class="line-clamp-2 max-w-full leading-snug font-medium break-words whitespace-normal"
                    data-testid="next-article-title"
                  >
                    {{ nextArticle()!.title }}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  class="grid shrink-0 place-items-center self-stretch"
                  data-testid="next-article-icon-wrapper"
                >
                  <z-icon
                    zType="arrow-right"
                    class="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </a>
            }
          </nav>
        }
      } @else {
        <div
          data-testid="help-login-prompt"
          class="rounded border border-border p-8 text-center"
        >
          <h2 class="mb-2 font-display text-xl font-semibold">
            sign in to access this article
          </h2>
          <p class="mb-6 text-muted-foreground">
            this article is restricted to {{ accessLevelLabel() }} members.
          </p>
          <a
            z-button
            routerLink="/login"
            [queryParams]="{returnUrl: '/help/' + section() + '/' + slug()}"
          >
            sign in
          </a>
        </div>
      }
    } @else if (!manifestLoaded()) {
      <!-- Deep link while the manifest is still loading — skeleton, not a false not-found -->
      <div
        class="space-y-4"
        data-testid="article-manifest-loading-state"
        aria-hidden="true"
      >
        <z-skeleton class="h-9 w-2/3" />
        <div class="space-y-2 pt-4">
          <z-skeleton class="h-4 w-full" />
          <z-skeleton class="h-4 w-11/12" />
          <z-skeleton class="h-4 w-4/5" />
        </div>
      </div>
    } @else {
      <div
        class="text-muted-foreground"
        data-testid="article-not-found-state"
        role="status"
      >
        <h1 class="mb-4 font-display text-2xl font-bold tracking-tight">
          article not found
        </h1>
        <p>this article doesn't exist or has moved.</p>
        <a
          [routerLink]="['/help', section()]"
          class="mt-4 inline-block font-mono text-sm tracking-widest text-muted-foreground uppercase transition-colors hover:text-foreground"
        >
          back to {{ sectionLabel() }}
        </a>
      </div>
    }
  `,
})
export class ArticleComponent {
  readonly section = input.required<HelpSection>();
  readonly slug = input.required<string>();

  private readonly markdown = viewChild(MarkdownComponent);
  private readonly manifest = inject(HelpManifestService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  readonly article = computed<HelpArticle | undefined>(() =>
    this.manifest.getArticle(this.section(), this.slug()),
  );

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

  readonly manifestLoaded = computed(() => this.manifest.isLoaded());

  // undefined until the manifest resolves the article — keeps the resource
  // idle so unknown slugs surface as not-found instead of a fetch error.
  private readonly articlePath = computed(() => {
    const a = this.article();
    if (!a) return undefined;
    const relPath = a.path ?? `${this.slug()}.md`;
    return `/docs/${this.section()}/${relPath}`;
  });

  readonly markdownContent = resource({
    params: () => {
      const path = this.articlePath();
      return path === undefined ? undefined : {path};
    },
    loader: async ({params}) => {
      const raw = await firstValueFrom(
        this.http.get(params.path, {responseType: 'text'}),
      );
      return raw.replace(/^---[\s\S]*?---\n*/, '');
    },
  });

  readonly hasLoadError = computed<boolean>(
    () => this.markdownContent.error() != null || this.manifest.loadFailed(),
  );
  readonly markdownContentValue = computed(() =>
    safeResourceValue(this.markdownContent),
  );

  readonly canAccess = computed<boolean>(() => {
    const a = this.article();
    if (!a) return false;
    const role = this.auth.isAuthenticated() ? this.auth.userRole() : undefined;
    return this.manifest.canAccess(a, role);
  });

  readonly accessLevelLabel = computed(() => {
    const a = this.article();
    if (!a) return '';
    const access = this.manifest.getArticleAccess(a);
    switch (access) {
      case 'root_admin':
        return 'root admin';
      case 'community_admin':
        return 'community admin';
      case 'authenticated':
        return 'signed-in';
      case 'public':
        return 'public';
      default:
        return '';
    }
  });

  private readonly sectionArticles = computed<HelpArticle[]>(() => {
    const role = this.auth.isAuthenticated() ? this.auth.userRole() : undefined;
    return this.manifest
      .getAccessibleArticles(role)
      .filter((a) => a.section === this.section());
  });

  readonly prevArticle = computed<HelpArticle | undefined>(() => {
    const articles = this.sectionArticles();
    const idx = articles.findIndex((a) => a.slug === this.slug());
    return idx > 0 ? articles[idx - 1] : undefined;
  });

  readonly nextArticle = computed<HelpArticle | undefined>(() => {
    const articles = this.sectionArticles();
    const idx = articles.findIndex((a) => a.slug === this.slug());
    return idx >= 0 && idx < articles.length - 1
      ? articles[idx + 1]
      : undefined;
  });

  enhanceMarkdown(): void {
    const root = this.markdown()?.element.nativeElement;
    highlightArticleCode(root);
  }
}
