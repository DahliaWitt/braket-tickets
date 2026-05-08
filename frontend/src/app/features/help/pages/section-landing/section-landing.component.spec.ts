import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SectionLandingComponent } from './section-landing.component';
import { HelpManifestService } from '../../services/help-manifest.service';
import { type HelpArticle } from '../../models/help.models';
import { type ComponentFixture } from '@angular/core/testing';

const MOCK_ARTICLES: HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    category: 'Basics',
    order: 1,
    description: 'How to get started with the platform',
    access: 'public',
    section: 'users',
    body: 'Welcome to the platform.',
  },
  {
    slug: 'buy-tickets',
    title: 'Buying Tickets',
    category: 'Tickets',
    order: 1,
    description: 'How to purchase tickets',
    access: 'public',
    section: 'users',
    body: 'Purchase tickets for events.',
  },
  {
    slug: 'admin-overview',
    title: 'Admin Overview',
    category: 'Getting Started',
    order: 1,
    description: 'Overview for admins',
    access: 'root_admin',
    section: 'admins',
    body: 'Admin content here.',
  },
];

describe('SectionLandingComponent', () => {
  let fixture: ComponentFixture<SectionLandingComponent>;
  let httpController: HttpTestingController;
  let manifestService: HelpManifestService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionLandingComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        HelpManifestService,
      ],
    }).compileComponents();

    httpController = TestBed.inject(HttpTestingController);
    manifestService = TestBed.inject(HelpManifestService);

    // Pre-populate manifest
    const loadPromise = manifestService.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;

    fixture = TestBed.createComponent(SectionLandingComponent);
    fixture.componentRef.setInput('section', 'users');
    await fixture.whenStable();
  });

  afterEach(() => {
    httpController.verify();
  });

  it('renders article cards for the users section', () => {
    const cards = fixture.debugElement.queryAll(By.css('[data-testid="help-article-card"]'));
    // 2 user articles
    expect(cards.length).toBe(2);
  });

  it('shows section heading', () => {
    const heading = fixture.debugElement.query(By.css('h1'));
    expect((heading.nativeElement as HTMLElement).textContent).toContain('User Guide');
  });

  it('renders article titles and descriptions', () => {
    const cards = fixture.debugElement.queryAll(By.css('[data-testid="help-article-card"]'));
    const firstCard = cards[0].nativeElement as HTMLElement;
    expect(firstCard.textContent).toContain('Getting Started');
    expect(firstCard.textContent).toContain('How to get started');
  });
});

describe('SectionLandingComponent (late manifest load - BRA-147)', () => {
  let fixture: ComponentFixture<SectionLandingComponent>;
  let httpController: HttpTestingController;
  let manifestService: HelpManifestService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SectionLandingComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        HelpManifestService,
      ],
    }).compileComponents();

    httpController = TestBed.inject(HttpTestingController);
    manifestService = TestBed.inject(HelpManifestService);

    // Component created BEFORE manifest resolves — reproduces the bug
    fixture = TestBed.createComponent(SectionLandingComponent);
    fixture.componentRef.setInput('section', 'users');
    await fixture.whenStable();
  });

  afterEach(() => {
    httpController.verify();
  });

  it('renders articles after manifest loads', async () => {
    // No articles visible yet
    let cards = fixture.debugElement.queryAll(By.css('[data-testid="help-article-card"]'));
    expect(cards.length).toBe(0);

    // Now the manifest loads (simulating the shell resource() resolving)
    const loadPromise = manifestService.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;

    // Signal update should propagate — articles appear without re-navigation
    await fixture.whenStable();
    cards = fixture.debugElement.queryAll(By.css('[data-testid="help-article-card"]'));
    expect(cards.length).toBe(2);
  });
});
