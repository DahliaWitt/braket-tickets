import {describe, it, expect, beforeEach} from 'vitest';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {provideRouter} from '@angular/router';
import {By} from '@angular/platform-browser';
import {HelpShellComponent} from './help-shell.component';
import {HELP_ROUTES} from '../../help.routes';
import {HelpManifestService} from '../../services/help-manifest.service';
import {HelpSearchService} from '../../services/help-search.service';
import {AuthService} from '@/core/services/auth.service';
import {type HelpArticle} from '../../models/help.models';

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
