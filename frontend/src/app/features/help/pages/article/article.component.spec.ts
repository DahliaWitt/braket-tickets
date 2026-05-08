import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal, computed } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { By } from '@angular/platform-browser';
import { describe, it, expect, afterEach } from 'vitest';
import { ArticleComponent } from './article.component';
import { ArticleComponentHarness } from './article.component.harness';
import { HelpManifestService } from '../../services/help-manifest.service';
import { type HelpArticle } from '../../models/help.models';
import { type ComponentFixture } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '@/core/services/auth.service';

const MOCK_ARTICLES: HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    category: 'Basics',
    order: 1,
    description: 'How to get started',
    access: 'public',
    section: 'users',
    body: 'Welcome to the platform.',
  },
  {
    slug: 'admin-only',
    title: 'Admin Only',
    category: 'Admin',
    order: 1,
    description: 'Admin-only article',
    access: 'root_admin',
    section: 'admins',
    body: 'Secret admin content.',
  },
  {
    slug: 'buying-tickets',
    title: 'Buying Tickets',
    category: 'Basics',
    order: 2,
    description: 'How to buy tickets',
    access: 'public',
    section: 'users',
    body: 'Buy tickets here.',
  },
];

function makeAuthServiceMock(isAuthenticated: boolean) {
  const isAuthSignal = signal(isAuthenticated);
  const userRoleSignal = signal<'root_admin' | 'community_admin' | 'user'>('user');
  return {
    isAuthenticated: computed(() => isAuthSignal()),
    userRole: computed(() => userRoleSignal()),
  };
}

describe('ArticleComponent', () => {
  let fixture: ComponentFixture<ArticleComponent>;
  let httpController: HttpTestingController;
  let manifestService: HelpManifestService;

  async function setup(
    section: 'users' | 'admins',
    slug: string,
    isAuthenticated = false,
    markdown = `---\ntitle: Test\n---\n# Test Content`,
    articles = MOCK_ARTICLES,
  ): Promise<void> {
    const authMock = makeAuthServiceMock(isAuthenticated);

    await TestBed.configureTestingModule({
      imports: [ArticleComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideMarkdown({ loader: HttpClient }),
        HelpManifestService,
        { provide: AuthService, useValue: authMock },
      ],
    }).compileComponents();

    httpController = TestBed.inject(HttpTestingController);
    manifestService = TestBed.inject(HelpManifestService);

    // Pre-populate manifest
    const loadPromise = manifestService.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(articles);
    await loadPromise;

    fixture = TestBed.createComponent(ArticleComponent);
    fixture.componentRef.setInput('section', section);
    fixture.componentRef.setInput('slug', slug);

    // The markdownContent resource loader is async — give it a microtask turn
    // to fire the HTTP request, then flush it so whenStable() doesn't hang.
    await new Promise((r) => setTimeout(r, 0));
    const mdRequest = httpController.match(`/docs/${section}/${slug}.md`);
    if (mdRequest.length) {
      mdRequest[0].flush(markdown);
    }
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    // Flush any pending markdown requests so httpController.verify() passes
    httpController.match(() => true);
    httpController.verify();
    TestBed.resetTestingModule();
  });

  it('renders article content area for a public article', async () => {
    await setup('users', 'getting-started', false);
    const contentArea = fixture.debugElement.query(By.css('[data-testid="help-article-content"]'));
    expect(contentArea).toBeTruthy();
  });

  it('renders breadcrumb', async () => {
    await setup('users', 'getting-started', false);
    const breadcrumb = fixture.debugElement.query(By.css('[data-testid="help-breadcrumb"]'));
    expect(breadcrumb).toBeTruthy();
    expect((breadcrumb.nativeElement as HTMLElement).textContent).toContain('Help');
    expect((breadcrumb.nativeElement as HTMLElement).textContent).toContain('User Guide');
    expect((breadcrumb.nativeElement as HTMLElement).textContent).toContain('Getting Started');
  });

  it('shows login prompt for admin-gated article when unauthenticated', async () => {
    await setup('admins', 'admin-only', false);
    const loginPrompt = fixture.debugElement.query(By.css('[data-testid="help-login-prompt"]'));
    expect(loginPrompt).toBeTruthy();

    const contentArea = fixture.debugElement.query(By.css('[data-testid="help-article-content"]'));
    expect(contentArea).toBeNull();
  });

  it('does not show error state when article loads successfully', async () => {
    await setup('users', 'getting-started', false);
    const errorEl = fixture.debugElement.query(By.css('[data-testid="article-error-state"]'));
    expect(errorEl).toBeNull();
  });

  it('hasLoadError returns false when markdown loads successfully', async () => {
    await setup('users', 'getting-started', false);
    expect(fixture.componentInstance.hasLoadError()).toBe(false);
  });

  it('applies highlight.js classes to fenced code blocks', async () => {
    await setup(
      'users',
      'getting-started',
      false,
      '```typescript\nconst total = 1;\n```',
    );

    const highlightedBlock = fixture.debugElement.query(By.css('pre code.hljs.language-typescript'));
    expect(highlightedBlock).toBeTruthy();
  });

  it('disables typography-generated inline code backticks', async () => {
    await setup('users', 'getting-started', false, 'Use `injectQuery()` for live reads.');

    const contentArea = fixture.debugElement.query(By.css('[data-testid="help-article-content"]'));
    const classes = (contentArea.nativeElement as HTMLElement).className;

    expect(classes).toContain('prose-code:before:content-none');
    expect(classes).toContain('prose-code:after:content-none');
  });

  it('lets prev/next navigation titles use the full link width instead of a 45 percent cap', async () => {
    await setup('users', 'getting-started', false);

    const harness = await TestbedHarnessEnvironment.harnessForFixture(fixture, ArticleComponentHarness);

    expect(await harness.hasNextNavigation()).toBe(true);
    expect(await harness.getNextLinkClasses()).toContain('flex-auto');
    expect(await harness.getNextLinkClasses()).toContain('min-w-0');
    expect(await harness.getNextTitleClasses()).not.toContain('max-w-[45%]');
    expect(await harness.getNextTitleClasses()).toContain('max-w-full');
  });

  it('bounds long prev/next navigation titles to a two-line wrap', async () => {
    const longTitleArticles = MOCK_ARTICLES.map((article) =>
      article.slug === 'buying-tickets'
        ? {
            ...article,
            title: 'Deploying the E2E Environment Setup for Long Developer Article Titles',
          }
        : article,
    );

    await setup('users', 'getting-started', false, undefined, longTitleArticles);

    const harness = await TestbedHarnessEnvironment.harnessForFixture(fixture, ArticleComponentHarness);
    const nextTitleClasses = await harness.getNextTitleClasses();

    expect(nextTitleClasses).toContain('line-clamp-2');
    expect(nextTitleClasses).toContain('whitespace-normal');
    expect(nextTitleClasses).toContain('break-words');
    expect(nextTitleClasses).toContain('leading-snug');
    expect(nextTitleClasses).not.toContain('truncate');
  });

  it('renders directional icons in prev/next navigation', async () => {
    await setup('users', 'getting-started', false);

    const harness = await TestbedHarnessEnvironment.harnessForFixture(fixture, ArticleComponentHarness);
    const nextIconWrapperClasses = await harness.getNextIconWrapperClasses();

    expect(await harness.hasNextIcon()).toBe(true);
    expect(nextIconWrapperClasses).toContain('place-items-center');
    expect(nextIconWrapperClasses).toContain('self-stretch');
  });

  it('distinguishes prev and next navigation when only one footer link is present', async () => {
    await setup('users', 'buying-tickets', false);

    const harness = await TestbedHarnessEnvironment.harnessForFixture(fixture, ArticleComponentHarness);

    expect(await harness.hasPrevNavigation()).toBe(true);
    expect(await harness.hasNextNavigation()).toBe(false);
    expect(await harness.hasPrevIcon()).toBe(true);
  });
});

describe('ArticleComponent — markdown fetch error', () => {
  let fixture: ComponentFixture<ArticleComponent>;
  let httpController: HttpTestingController;
  let manifestService: HelpManifestService;

  async function setupWithError(
    section: 'users' | 'admins',
    slug: string,
    isAuthenticated = false,
  ): Promise<void> {
    const authMock = makeAuthServiceMock(isAuthenticated);

    await TestBed.configureTestingModule({
      imports: [ArticleComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideMarkdown({ loader: HttpClient }),
        HelpManifestService,
        { provide: AuthService, useValue: authMock },
      ],
    }).compileComponents();

    httpController = TestBed.inject(HttpTestingController);
    manifestService = TestBed.inject(HelpManifestService);

    // Pre-populate manifest
    const loadPromise = manifestService.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;

    fixture = TestBed.createComponent(ArticleComponent);
    fixture.componentRef.setInput('section', section);
    fixture.componentRef.setInput('slug', slug);

    // Respond with a 404 error to simulate fetch failure
    await new Promise((r) => setTimeout(r, 0));
    const mdRequest = httpController.match(`/docs/${section}/${slug}.md`);
    if (mdRequest.length) {
      mdRequest[0].flush('Not Found', { status: 404, statusText: 'Not Found' });
    }
    await fixture.whenStable();
  }

  afterEach(() => {
    httpController.match(() => true);
    httpController.verify();
    TestBed.resetTestingModule();
  });

  it('shows error state when markdown fetch fails', async () => {
    await setupWithError('users', 'getting-started', false);
    const errorEl = fixture.debugElement.query(By.css('[data-testid="article-error-state"]'));
    expect(errorEl).toBeTruthy();
  });

  it('error state contains error heading', async () => {
    await setupWithError('users', 'getting-started', false);
    const errorEl = fixture.debugElement.query(By.css('[data-testid="article-error-state"]'));
    expect((errorEl.nativeElement as HTMLElement).textContent).toContain('hit a snag');
  });

  it('error state contains link back to help center', async () => {
    await setupWithError('users', 'getting-started', false);
    const backLink = fixture.debugElement.query(
      By.css('[data-testid="article-error-state"] a[routerLink]'),
    );
    expect(backLink).toBeTruthy();
    expect((backLink.nativeElement as HTMLElement).textContent).toContain('Back to Help Center');
  });

  it('does not render article content area when markdown fetch fails', async () => {
    await setupWithError('users', 'getting-started', false);
    const contentArea = fixture.debugElement.query(By.css('[data-testid="help-article-content"]'));
    expect(contentArea).toBeNull();
  });

  it('hasLoadError returns true when markdown fetch fails', async () => {
    await setupWithError('users', 'getting-started', false);
    expect(fixture.componentInstance.hasLoadError()).toBe(true);
  });
});
