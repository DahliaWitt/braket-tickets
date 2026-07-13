import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {provideRouter, Router} from '@angular/router';
import {By} from '@angular/platform-browser';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {describe, it, expect, beforeEach, vi} from 'vitest';
import {HelpSearchComponent} from './help-search.component';
import {HelpSearchComponentHarness} from './help-search.component.harness';
import {HelpSearchService} from '../../services/help-search.service';
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
    body: 'Welcome to the platform. This guide will help you get started.',
  },
  {
    slug: 'account-settings',
    title: 'Account Settings',
    category: 'Basics',
    order: 2,
    description: 'Manage your account preferences',
    access: 'authenticated',
    section: 'users',
    body: 'Configure your account settings including password and notifications.',
  },
  {
    slug: 'stripe-sandbox-setup',
    title: 'Stripe Sandbox Setup',
    category: 'Developer Guide',
    order: 1,
    description: 'Configure Stripe in sandbox mode',
    access: 'root_admin',
    section: 'developers',
    body: 'Configure the Stripe sandbox for local development and testing.',
  },
  {
    slug: 'event-management',
    title: 'Event Management',
    category: 'Admin',
    order: 1,
    description: 'Manage events as an admin',
    access: 'community_admin',
    section: 'admins',
    body: 'Learn how to create and manage events as a community admin.',
  },
];

describe('HelpSearchComponent', () => {
  let fixture: ComponentFixture<HelpSearchComponent>;
  let searchService: HelpSearchService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HelpSearchComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        HelpSearchService,
      ],
    }).compileComponents();

    searchService = TestBed.inject(HelpSearchService);
    searchService.buildIndex(MOCK_ARTICLES);

    fixture = TestBed.createComponent(HelpSearchComponent);
    await fixture.whenStable();
  });

  it('renders search input', () => {
    const input = fixture.debugElement.query(
      By.css('[data-testid="help-search-input"]'),
    );
    expect(input).toBeTruthy();
    expect((input.nativeElement as HTMLInputElement).getAttribute('type')).toBe(
      'search',
    );
  });

  it('hides results when query is empty', () => {
    const results = fixture.debugElement.query(
      By.css('[data-testid="help-search-results"]'),
    );
    expect(results).toBeNull();
  });

  it('shows results dropdown when query matches', async () => {
    const input = fixture.debugElement.query(
      By.css('[data-testid="help-search-input"]'),
    );
    (input.nativeElement as HTMLInputElement).value = 'getting';
    (input.nativeElement as HTMLInputElement).dispatchEvent(
      new Event('input', {bubbles: true}),
    );
    await fixture.whenStable();

    const results = fixture.debugElement.query(
      By.css('[data-testid="help-search-results"]'),
    );
    expect(results).toBeTruthy();
  });

  it('shows a no-match state instead of unrelated results for gibberish', async () => {
    const harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      HelpSearchComponentHarness,
    );

    await harness.typeQuery('zzzz-not-real-doc');
    await fixture.whenStable();

    expect(await harness.getResultCount()).toBe(0);
    expect(await harness.getNoResultsMessageText()).toContain(
      'no matching articles found',
    );
  });

  describe('dropdown dismissal', () => {
    async function getHarness(): Promise<HelpSearchComponentHarness> {
      return TestbedHarnessEnvironment.harnessForFixture(
        fixture,
        HelpSearchComponentHarness,
      );
    }

    it('dismisses the dropdown when focus leaves the component', async () => {
      const harness = await getHarness();
      await harness.typeQuery('getting');
      expect(await harness.isResultsDropdownVisible()).toBe(true);

      await harness.dispatchFocusOutside();
      expect(await harness.isResultsDropdownVisible()).toBe(false);
      expect(await harness.getAriaExpanded()).toBe('false');
    });

    it('keeps the query after dismissal and reopens on focus', async () => {
      const harness = await getHarness();
      await harness.typeQuery('getting');
      await harness.dispatchFocusOutside();
      expect(await harness.isResultsDropdownVisible()).toBe(false);
      expect(await harness.getQueryValue()).toBe('getting');

      await harness.dispatchFocus();
      expect(await harness.isResultsDropdownVisible()).toBe(true);
    });

    it('does not reopen on focus when the query is empty', async () => {
      const harness = await getHarness();
      await harness.dispatchFocus();
      expect(await harness.isResultsDropdownVisible()).toBe(false);
    });

    it('stays open when focus moves to a result inside the component', async () => {
      const harness = await getHarness();
      await harness.typeQuery('getting');
      expect(await harness.isResultsDropdownVisible()).toBe(true);

      // Simulate the focusout fired when the user mousedowns a result:
      // relatedTarget is the result button, which lives inside the component.
      const input = fixture.debugElement.query(
        By.css('[data-testid="help-search-input"]'),
      ).nativeElement as HTMLInputElement;
      const resultButton = fixture.debugElement.query(
        By.css('[data-testid="help-search-results"] button[role="option"]'),
      ).nativeElement as HTMLButtonElement;
      input.dispatchEvent(
        new FocusEvent('focusout', {
          bubbles: true,
          relatedTarget: resultButton,
        }),
      );
      await fixture.whenStable();

      expect(await harness.isResultsDropdownVisible()).toBe(true);
    });

    it('clicking a result still navigates after the focusout guard', async () => {
      const harness = await getHarness();
      const router = TestBed.inject(Router);
      const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

      await harness.typeQuery('getting');
      await harness.clickResult(0);

      expect(navigateSpy).toHaveBeenCalledWith([
        '/help',
        'users',
        'getting-started',
      ]);
      expect(await harness.isResultsDropdownVisible()).toBe(false);
    });
  });

  describe('section badge labels', () => {
    function triggerSearch(query: string): void {
      const input = fixture.debugElement.query(
        By.css('[data-testid="help-search-input"]'),
      );
      (input.nativeElement as HTMLInputElement).value = query;
      (input.nativeElement as HTMLInputElement).dispatchEvent(
        new Event('input', {bubbles: true}),
      );
    }

    function getBadgeTexts(): string[] {
      const badges = fixture.debugElement.queryAll(
        By.css('[data-testid="help-search-result-badge"]'),
      );
      return badges.map(
        (b) => (b.nativeElement as HTMLElement).textContent?.trim() ?? '',
      );
    }

    it('shows "User" badge for users section articles', async () => {
      triggerSearch('getting started');
      await fixture.whenStable();

      const badges = getBadgeTexts();
      expect(badges.length).toBeGreaterThan(0);
      expect(badges[0]).toBe('User');
    });

    it('shows "Admin" badge for admins section articles', async () => {
      triggerSearch('event management');
      await fixture.whenStable();

      const badges = getBadgeTexts();
      expect(badges.length).toBeGreaterThan(0);
      expect(badges[0]).toBe('Admin');
    });

    it('shows "Developer" badge for developers section articles', async () => {
      triggerSearch('stripe');
      await fixture.whenStable();

      const badges = getBadgeTexts();
      expect(badges.length).toBeGreaterThan(0);
      expect(badges[0]).toBe('Developer');
    });
  });
});
