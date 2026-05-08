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

@Component({
  selector: 'app-article',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MarkdownComponent, ZardIconComponent],
  template: `
    <!-- Breadcrumb -->
    <nav
      aria-label="Breadcrumb"
      data-testid="help-breadcrumb"
      class="flex items-center gap-2 text-sm text-muted-foreground mb-6"
    >
      <a routerLink="/help" class="hover:text-foreground transition-colors"
        >Help</a
      >
      <span>/</span>
      <a
        [routerLink]="['/help', section()]"
        class="hover:text-foreground transition-colors capitalize"
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
        class="w-full max-w-xl mx-auto flex flex-col items-center justify-center text-center py-16 animate-in fade-in zoom-in duration-500"
        data-testid="article-error-state"
        role="alert"
        aria-live="assertive"
      >
        <div
          class="w-20 h-20 mb-6 rounded-full bg-destructive/20 flex items-center justify-center"
        >
          <span class="text-destructive text-4xl" aria-hidden="true">!</span>
        </div>
        <h2
          class="text-2xl md:text-3xl font-bold uppercase tracking-tight mb-4 text-destructive font-display"
        >
          hit a snag
        </h2>
        <p class="text-muted-foreground text-lg mb-8 font-sans">
          couldn't load this article — try again later
        </p>
        <a
          routerLink="/help"
          class="text-sm uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors font-mono"
        >
          Back to Help Center
        </a>
      </div>
    } @else if (article()) {
      @if (canAccess()) {
        <article
          data-testid="help-article-content"
          class="prose dark:prose-invert max-w-none font-sans prose-headings:font-display prose-h1:font-sans prose-h1:text-3xl prose-h1:font-bold prose-h2:text-xl prose-h3:text-lg prose-p:text-muted-foreground prose-a:text-primary prose-code:text-primary prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-card prose-pre:border prose-pre:border-border"
        >
          @if (markdownContent.isLoading()) {
            <p
              class="text-muted-foreground animate-pulse"
              data-testid="article-loading-state"
            >
              Loading article...
            </p>
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
                class="group flex min-w-0 flex-auto items-center gap-3 text-sm hover:text-foreground transition-colors text-muted-foreground"
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
                  <span class="font-mono text-2xs uppercase tracking-widest"
                    >Previous</span
                  >
                  <span
                    class="line-clamp-2 max-w-full whitespace-normal break-words font-medium leading-snug"
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
                class="group flex min-w-0 flex-auto items-center justify-end gap-3 text-right text-sm hover:text-foreground transition-colors text-muted-foreground"
                data-testid="next-article-link"
              >
                <span class="flex min-w-0 flex-col gap-1">
                  <span class="font-mono text-2xs uppercase tracking-widest"
                    >Next</span
                  >
                  <span
                    class="line-clamp-2 max-w-full whitespace-normal break-words font-medium leading-snug"
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
          <h2 class="text-xl font-display font-semibold mb-2">
            Sign in to access this article
          </h2>
          <p class="text-muted-foreground mb-6">
            This article is restricted to {{ accessLevelLabel() }} members.
          </p>
          <a
            routerLink="/login"
            [queryParams]="{returnUrl: '/help/' + section() + '/' + slug()}"
            class="inline-flex items-center px-4 py-2 rounded bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            Sign in
          </a>
        </div>
      }
    } @else {
      <div class="text-muted-foreground">
        <h1 class="text-2xl font-display font-bold mb-4">Article not found</h1>
        <p>The article you're looking for doesn't exist or has been moved.</p>
        <a
          [routerLink]="['/help', section()]"
          class="text-primary hover:underline mt-4 inline-block"
        >
          Back to {{ sectionLabel() }}
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
        return 'User Guide';
      case 'admins':
        return 'Admin Guide';
      case 'developers':
        return 'Developer Guide';
      default:
        return s;
    }
  });

  private readonly articlePath = computed(() => {
    const a = this.article();
    const relPath = a?.path ?? `${this.slug()}.md`;
    return `/docs/${this.section()}/${relPath}`;
  });

  readonly markdownContent = resource({
    params: () => ({path: this.articlePath()}),
    loader: async ({params}) => {
      const raw = await firstValueFrom(
        this.http.get(params.path, {responseType: 'text'}),
      );
      return raw.replace(/^---[\s\S]*?---\n*/, '');
    },
  });

  readonly hasLoadError = computed<boolean>(
    () => this.markdownContent.error() != null,
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
