import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {provideHttpClient} from '@angular/common/http';
import {
  provideHttpClientTesting,
  HttpTestingController,
} from '@angular/common/http/testing';
import {provideRouter} from '@angular/router';
import {By} from '@angular/platform-browser';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {SectionLandingComponent} from './section-landing.component';
import {SectionLandingComponentHarness} from './section-landing.component.harness';
import {HelpManifestService} from '../../services/help-manifest.service';
import {type HelpArticle} from '../../models/help.models';
import {type ComponentFixture} from '@angular/core/testing';

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
    const cards = fixture.debugElement.queryAll(
      By.css('[data-testid="help-article-card"]'),
    );
    // 2 user articles
    expect(cards.length).toBe(2);
  });

  it('shows section heading', () => {
    const heading = fixture.debugElement.query(By.css('h1'));
    expect((heading.nativeElement as HTMLElement).textContent).toContain(
      'user guide',
    );
  });

  it('uses the standard responsive display heading ramp', () => {
    const heading = fixture.debugElement.query(By.css('h1'));
    const classes = (heading.nativeElement as HTMLElement).className;
    expect(classes).toContain('text-2xl');
    expect(classes).toContain('sm:text-3xl');
    expect(classes).toContain('lg:text-4xl');
    expect(classes).toContain('font-display');
    expect(classes).toContain('tracking-tight');
  });

  it('renders article cards as tinted tiles with border as hover affordance only', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      SectionLandingComponentHarness,
    );
    const classes = await harness.getArticleCardClasses(0);
    expect(classes).toContain('bg-card');
    expect(classes).toContain('border-transparent');
    expect(classes).toContain('hover:border-primary');
    expect(classes).toContain('focus-visible:border-primary');
  });

  it('renders article titles and descriptions', () => {
    const cards = fixture.debugElement.queryAll(
      By.css('[data-testid="help-article-card"]'),
    );
    const firstCard = cards[0].nativeElement as HTMLElement;
    expect(firstCard.textContent).toContain('Getting Started');
    expect(firstCard.textContent).toContain('How to get started');
  });

  it('gives the developer overview video a descriptive title and no dead size attributes', async () => {
    fixture.componentRef.setInput('section', 'developers');
    await fixture.whenStable();

    const iframe = fixture.debugElement.query(By.css('iframe'));
    expect(iframe).toBeTruthy();
    const el = iframe.nativeElement as HTMLIFrameElement;
    expect(el.getAttribute('title')).toBe(
      'Braket Tickets developer onboarding overview',
    );
    expect(el.getAttribute('width')).toBeNull();
    expect(el.getAttribute('height')).toBeNull();
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
    let cards = fixture.debugElement.queryAll(
      By.css('[data-testid="help-article-card"]'),
    );
    expect(cards.length).toBe(0);

    // Now the manifest loads (simulating the shell resource() resolving)
    const loadPromise = manifestService.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;

    // Signal update should propagate — articles appear without re-navigation
    await fixture.whenStable();
    cards = fixture.debugElement.queryAll(
      By.css('[data-testid="help-article-card"]'),
    );
    expect(cards.length).toBe(2);
  });

  it('shows a loading skeleton (not the empty state) while the manifest loads', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      SectionLandingComponentHarness,
    );

    expect(await harness.isLoadingStateVisible()).toBe(true);
    expect(await harness.isEmptyStateVisible()).toBe(false);
    expect(await harness.isErrorStateVisible()).toBe(false);

    const loadPromise = manifestService.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(MOCK_ARTICLES);
    await loadPromise;
    await fixture.whenStable();

    expect(await harness.isLoadingStateVisible()).toBe(false);
    expect(await harness.getArticleCardCount()).toBe(2);
  });
});

describe('SectionLandingComponent — manifest states', () => {
  let fixture: ComponentFixture<SectionLandingComponent>;
  let httpController: HttpTestingController;
  let manifestService: HelpManifestService;
  let harness: SectionLandingComponentHarness;

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

    fixture = TestBed.createComponent(SectionLandingComponent);
    fixture.componentRef.setInput('section', 'users');
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      SectionLandingComponentHarness,
    );
  });

  afterEach(() => {
    httpController.verify();
  });

  it('shows the branded error state (never the empty state) when the manifest fails', async () => {
    const loadPromise = manifestService.loadManifest().catch(() => undefined);
    httpController
      .expectOne('/docs/manifest.json')
      .flush('boom', {status: 500, statusText: 'Server Error'});
    await loadPromise;
    await fixture.whenStable();

    expect(await harness.isErrorStateVisible()).toBe(true);
    expect(await harness.getErrorStateText()).toContain('hit a snag');
    expect(await harness.isEmptyStateVisible()).toBe(false);
    expect(await harness.isLoadingStateVisible()).toBe(false);
  });

  it('shows the empty state only when the manifest loaded with no articles for the section', async () => {
    const adminOnly = MOCK_ARTICLES.filter((a) => a.section === 'admins');
    const loadPromise = manifestService.loadManifest();
    httpController.expectOne('/docs/manifest.json').flush(adminOnly);
    await loadPromise;
    await fixture.whenStable();

    expect(await harness.isEmptyStateVisible()).toBe(true);
    expect(await harness.getEmptyStateText()).toContain('nothing here yet');
    expect(await harness.isErrorStateVisible()).toBe(false);
  });
});
