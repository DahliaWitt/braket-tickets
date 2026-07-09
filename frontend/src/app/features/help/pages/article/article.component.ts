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
      class="mb-6 flex items-center gap-2 text-sm text-muted-foreground"
    >
      <a routerLink="/help" class="transition-colors hover:text-foreground"
        >Help</a
      >
      <span>/</span>
      <a
        [routerLink]="['/help', section()]"
        class="capitalize transition-colors hover:text-foreground"
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
          Back to Help Center
        </a>
      </div>
    } @else if (article()) {
      @if (canAccess()) {
        <article
          data-testid="help-article-content"
          class="prose max-w-none font-sans dark:prose-invert prose-headings:font-display prose-h1:font-sans prose-h1:text-3xl prose-h1:font-bold prose-h2:text-xl prose-h3:text-lg prose-p:text-muted-foreground prose-a:text-primary prose-code:rounded prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:border-border prose-pre:bg-card"
        >
          @if (markdownContent.isLoading()) {
            <p
              class="animate-pulse text-muted-foreground"
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
                    >Previous</span
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
                    >Next</span
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
            Sign in to access this article
          </h2>
          <p class="mb-6 text-muted-foreground">
            This article is restricted to {{ accessLevelLabel() }} members.
          </p>
          <a
            routerLink="/login"
            [queryParams]="{returnUrl: '/help/' + section() + '/' + slug()}"
            class="inline-flex items-center rounded bg-primary px-4 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign in
          </a>
        </div>
      }
    } @else {
      <div class="text-muted-foreground">
        <h1 class="mb-4 font-display text-2xl font-bold">Article not found</h1>
        <p>The article you're looking for doesn't exist or has been moved.</p>
        <a
          [routerLink]="['/help', section()]"
          class="mt-4 inline-block text-primary hover:underline"
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
