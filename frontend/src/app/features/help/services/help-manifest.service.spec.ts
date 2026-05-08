import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HelpManifestService } from './help-manifest.service';
import { type HelpArticle } from '../models/help.models';

const MOCK_ARTICLES: HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    category: 'Basics',
    order: 1,
    description: 'How to get started',
    section: 'users',
    body: 'Welcome',
  },
  {
    slug: 'admin-panel',
    title: 'Admin Panel',
    category: 'Admin',
    order: 1,
    description: 'Admin-only article',
    section: 'admins',
    body: 'Secret',
  },
  {
    slug: 'api-docs',
    title: 'API Docs',
    category: 'Dev',
    order: 1,
    description: 'Developer docs',
    section: 'developers',
    body: 'API',
  },
];

describe('HelpManifestService', () => {
  let service: HelpManifestService;
  let httpController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        HelpManifestService,
      ],
    });
    service = TestBed.inject(HelpManifestService);
    httpController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpController.verify();
  });

  it('loads and caches the manifest', async () => {
    const loadPromise = service.loadManifest();
    const req = httpController.expectOne('/docs/manifest.json');
    req.flush(MOCK_ARTICLES);
    const articles = await loadPromise;

    expect(articles).toHaveLength(MOCK_ARTICLES.length);

    const cached = await service.loadManifest();
    httpController.expectNone('/docs/manifest.json');
    expect(cached).toHaveLength(MOCK_ARTICLES.length);
  });

  it('clears the cached promise when loading fails so a later call can retry', async () => {
    const failedLoad = service.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush('request failed', {
      status: 500,
      statusText: 'Server Error',
    });

    await expect(failedLoad).rejects.toBeDefined();

    const retriedLoad = service.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);

    await expect(retriedLoad).resolves.toEqual(MOCK_ARTICLES);
  });

  it('filters articles by section', async () => {
    const loadPromise = service.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;

    const userArticles = service.getArticlesBySection('users');
    expect(userArticles).toHaveLength(1);
    expect(userArticles[0].slug).toBe('getting-started');
  });

  it('groups articles by category', async () => {
    const loadPromise = service.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;

    const categories = service.getCategoriesForSection('users');
    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe('Basics');
    expect(categories[0].articles).toHaveLength(1);
    expect(categories[0].articles[0].slug).toBe('getting-started');
  });

  it('finds article by section and slug', async () => {
    const loadPromise = service.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;

    const found = service.getArticle('users', 'getting-started');
    expect(found).toBeDefined();
    expect(found?.title).toBe('Getting Started');

    const missing = service.getArticle('users', 'nonexistent');
    expect(missing).toBeUndefined();
  });

  it('applies section default access when article has no explicit access', async () => {
    const loadPromise = service.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;

    const userArticle = service.getArticle('users', 'getting-started')!;
    const adminArticle = service.getArticle('admins', 'admin-panel')!;
    const devArticle = service.getArticle('developers', 'api-docs')!;

    expect(service.getArticleAccess(userArticle)).toBe('public');
    expect(service.getArticleAccess(adminArticle)).toBe('community_admin');
    expect(service.getArticleAccess(devArticle)).toBe('public');
  });

  it('filters accessible articles based on user role using section defaults', async () => {
    const loadPromise = service.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;

    const publicArticles = service.getAccessibleArticles(undefined);
    expect(publicArticles).toHaveLength(2);
    expect(publicArticles.map((a) => a.slug).sort()).toEqual(['api-docs', 'getting-started']);

    const communityAdminArticles = service.getAccessibleArticles('community_admin');
    expect(communityAdminArticles).toHaveLength(3);

    const rootAdminArticles = service.getAccessibleArticles('root_admin');
    expect(rootAdminArticles).toHaveLength(3);
  });

  it('respects explicit article access override', async () => {
    const articlesWithOverride: HelpArticle[] = [
      ...MOCK_ARTICLES,
      {
        slug: 'super-secret',
        title: 'Super Secret',
        category: 'Admin',
        order: 2,
        description: 'Admin only',
        access: 'root_admin',
        section: 'admins',
        body: 'Top secret',
      },
    ];

    const loadPromise = service.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(articlesWithOverride);
    await loadPromise;

    const superSecret = service.getArticle('admins', 'super-secret')!;
    expect(service.getArticleAccess(superSecret)).toBe('root_admin');

    const communityAdminArticles = service.getAccessibleArticles('community_admin');
    expect(communityAdminArticles.find((a) => a.slug === 'super-secret')).toBeUndefined();

    const rootAdminArticles = service.getAccessibleArticles('root_admin');
    expect(rootAdminArticles.find((a) => a.slug === 'super-secret')).toBeDefined();
  });
});
