import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {provideRouter} from '@angular/router';
import {By} from '@angular/platform-browser';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {HelpShellComponent} from './help-shell.component';
import {HelpShellComponentHarness} from './help-shell.component.harness';
import {HELP_ROUTES} from '../../help.routes';
import {HelpManifestService} from '../../services/help-manifest.service';
import {HelpSearchService} from '../../services/help-search.service';
import {AuthService} from '@/core/services/auth.service';
import {type HelpArticle} from '../../models/help.models';

function stubMatchMedia(matches: boolean): () => void {
  const original = window.matchMedia;
  window.matchMedia = (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  });
  return () => {
    window.matchMedia = original;
  };
}

class MockHelpManifestServiceError {
  loadManifest(): Promise<HelpArticle[]> {
    return Promise.reject(new Error('Network error'));
  }
  getArticlesBySection(): HelpArticle[] {
    return [];
  }
  getCategoriesForSection() {
    return [];
  }
  getArticle() {
    return undefined;
  }
  getAccessibleArticles(): HelpArticle[] {
    return [];
  }
  canAccess() {
    return false;
  }
}

class MockAuthService {
  isAuthenticated(): boolean {
    return false;
  }

  userRole(): 'root_admin' | 'community_admin' | 'user' {
    return 'user';
  }
}

describe('HelpShellComponent', () => {
  let fixture: ComponentFixture<HelpShellComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HelpShellComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(HELP_ROUTES),
        {provide: HelpManifestService, useClass: MockHelpManifestServiceError},
        HelpSearchService,
        {provide: AuthService, useValue: new MockAuthService()},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HelpShellComponent);
    // whenStable() may throw a ResourceValueError when the resource enters error state —
    // this is an Angular internal behavior. Catch and ignore it so the tests can proceed.
    await fixture.whenStable().catch(() => undefined);
    fixture.detectChanges();
  });

  it('shows the error state when manifest fails to load', () => {
    const errorEl = fixture.debugElement.query(
      By.css('[data-testid="help-shell-error-state"]'),
    );
    expect(errorEl).toBeTruthy();
    expect((errorEl.nativeElement as HTMLElement).textContent).toContain(
      "couldn't load articles",
    );
  });

  it('does not render the sidebar article list when manifest fails', () => {
    const sidebar = fixture.debugElement.query(By.css('app-help-sidebar'));
    expect(sidebar).toBeNull();
  });

  it('accessibleArticles returns empty array on error without throwing', () => {
    expect(() => fixture.componentInstance.accessibleArticles()).not.toThrow();
    expect(fixture.componentInstance.accessibleArticles()).toEqual([]);
  });

  it('hasLoadError returns true on manifest failure', () => {
    expect(fixture.componentInstance.hasLoadError()).toBe(true);
  });
});

describe('HelpShellComponent — mobile sidebar dialog semantics', () => {
  let fixture: ComponentFixture<HelpShellComponent>;
  let harness: HelpShellComponentHarness;
  let restoreMatchMedia: () => void;

  beforeEach(async () => {
    // Mobile viewport: the md media query does not match
    restoreMatchMedia = stubMatchMedia(false);

    await TestBed.configureTestingModule({
      imports: [HelpShellComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(HELP_ROUTES),
        {provide: HelpManifestService, useClass: MockHelpManifestServiceError},
        HelpSearchService,
        {provide: AuthService, useValue: new MockAuthService()},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HelpShellComponent);
    await fixture.whenStable().catch(() => undefined);
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      HelpShellComponentHarness,
    );
  });

  afterEach(() => {
    restoreMatchMedia();
  });

  it('closed sidebar has no dialog role and is inert (not tab-reachable)', async () => {
    expect(await harness.getSidebarRole()).toBeNull();
    expect(await harness.getSidebarAriaModal()).toBeNull();
    expect(await harness.isSidebarInert()).toBe(true);
  });

  it('open sidebar becomes a modal dialog and is no longer inert', async () => {
    await harness.clickMobileMenuButton();
    expect(await harness.getSidebarRole()).toBe('dialog');
    expect(await harness.getSidebarAriaModal()).toBe('true');
    expect(await harness.isSidebarInert()).toBe(false);
  });

  it('Escape on the open sidebar closes it and restores inert', async () => {
    await harness.clickMobileMenuButton();
    expect(await harness.isSidebarOpen()).toBe(true);

    await harness.sendEscapeToSidebar();
    expect(await harness.isSidebarOpen()).toBe(false);
    expect(await harness.getSidebarRole()).toBeNull();
    expect(await harness.isSidebarInert()).toBe(true);
  });

  it('backdrop is aria-hidden and not focusable', async () => {
    await harness.clickMobileMenuButton();
    expect(await harness.isOverlayVisible()).toBe(true);
    expect(await harness.isOverlayAriaHidden()).toBe(true);
    expect(await harness.getOverlayTabindex()).toBeNull();
  });

  it('clicking the backdrop closes the sidebar', async () => {
    await harness.clickMobileMenuButton();
    await harness.closeOverlay();
    expect(await harness.isSidebarOpen()).toBe(false);
  });
});

describe('HelpShellComponent — desktop sidebar semantics', () => {
  let fixture: ComponentFixture<HelpShellComponent>;
  let harness: HelpShellComponentHarness;
  let restoreMatchMedia: () => void;

  beforeEach(async () => {
    // Desktop viewport: the md media query matches
    restoreMatchMedia = stubMatchMedia(true);

    await TestBed.configureTestingModule({
      imports: [HelpShellComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(HELP_ROUTES),
        {provide: HelpManifestService, useClass: MockHelpManifestServiceError},
        HelpSearchService,
        {provide: AuthService, useValue: new MockAuthService()},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HelpShellComponent);
    await fixture.whenStable().catch(() => undefined);
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      HelpShellComponentHarness,
    );
  });

  afterEach(() => {
    restoreMatchMedia();
  });

  it('static desktop sidebar has no dialog role, no aria-modal, and is not inert', async () => {
    expect(await harness.getSidebarRole()).toBeNull();
    expect(await harness.getSidebarAriaModal()).toBeNull();
    expect(await harness.isSidebarInert()).toBe(false);
  });
});
