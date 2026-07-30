import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection, signal} from '@angular/core';
import {provideRouter} from '@angular/router';
import {By} from '@angular/platform-browser';
import {describe, it, expect, beforeEach} from 'vitest';
import {HelpSidebarComponent} from './help-sidebar.component';
import {type HelpArticle} from '../../models/help.models';
import {type ComponentFixture} from '@angular/core/testing';
import {AuthService} from '../../../../core/services/auth.service';

const MOCK_ARTICLES: HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    category: 'Basics',
    order: 1,
    description: 'How to get started',
    access: 'public',
    section: 'users',
    body: 'Welcome',
  },
  {
    slug: 'account-settings',
    title: 'Account Settings',
    category: 'Basics',
    order: 2,
    description: 'Managing your account',
    access: 'authenticated',
    section: 'users',
    body: 'Settings help',
  },
  {
    slug: 'managing-events',
    title: 'Managing Events',
    category: 'Events',
    order: 1,
    description: 'How to manage events',
    access: 'community_admin',
    section: 'admins',
    body: 'Admin events',
  },
  {
    slug: 'api-intro',
    title: 'API Introduction',
    category: 'Integration',
    order: 1,
    description: 'API docs',
    access: 'public',
    section: 'developers',
    body: 'API docs',
  },
];

describe('HelpSidebarComponent', () => {
  let fixture: ComponentFixture<HelpSidebarComponent>;
  let userRoleSignal: ReturnType<typeof signal<string>>;

  beforeEach(async () => {
    userRoleSignal = signal('user');

    await TestBed.configureTestingModule({
      imports: [HelpSidebarComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            userRole: () => userRoleSignal(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HelpSidebarComponent);
    fixture.componentRef.setInput('articles', MOCK_ARTICLES);
    fixture.componentRef.setInput('activeSection', 'users');
    await fixture.whenStable();
  });

  describe('section picker visibility', () => {
    it('does not show section picker for normal user on /help (only 1 section)', () => {
      const sectionLinks = fixture.debugElement.queryAll(
        By.css('[data-testid="help-section-link"]'),
      );
      expect(sectionLinks.length).toBe(0);
    });

    it('shows User Guide + Developer Guide for normal user on /help/developers', async () => {
      fixture.componentRef.setInput('activeSection', 'developers');
      await fixture.whenStable();

      const links = fixture.debugElement.queryAll(
        By.css('[data-testid="help-section-link"]'),
      );
      expect(links.length).toBe(2);
      expect((links[0].nativeElement as HTMLElement).textContent).toContain(
        'user guide',
      );
      expect((links[1].nativeElement as HTMLElement).textContent).toContain(
        'developer guide',
      );
    });

    it('shows User Guide + Admin Guide for admin on /help', async () => {
      userRoleSignal.set('root_admin');
      await fixture.whenStable();

      const links = fixture.debugElement.queryAll(
        By.css('[data-testid="help-section-link"]'),
      );
      expect(links.length).toBe(2);
      expect((links[0].nativeElement as HTMLElement).textContent).toContain(
        'user guide',
      );
      expect((links[1].nativeElement as HTMLElement).textContent).toContain(
        'admin guide',
      );
    });

    it('shows all three sections for admin on /help/developers', async () => {
      userRoleSignal.set('root_admin');
      fixture.componentRef.setInput('activeSection', 'developers');
      await fixture.whenStable();

      const links = fixture.debugElement.queryAll(
        By.css('[data-testid="help-section-link"]'),
      );
      expect(links.length).toBe(3);
      expect((links[0].nativeElement as HTMLElement).textContent).toContain(
        'user guide',
      );
      expect((links[1].nativeElement as HTMLElement).textContent).toContain(
        'admin guide',
      );
      expect((links[2].nativeElement as HTMLElement).textContent).toContain(
        'developer guide',
      );
    });

    it('shows admin guide for community_admin role', async () => {
      userRoleSignal.set('community_admin');
      await fixture.whenStable();

      const links = fixture.debugElement.queryAll(
        By.css('[data-testid="help-section-link"]'),
      );
      expect(links.length).toBe(2);
      expect((links[0].nativeElement as HTMLElement).textContent).toContain(
        'user guide',
      );
      expect((links[1].nativeElement as HTMLElement).textContent).toContain(
        'admin guide',
      );
    });
  });

  describe('article rendering', () => {
    it('groups articles by category for active section', () => {
      const categoryGroups = fixture.debugElement.queryAll(
        By.css('[data-testid="help-category-group"]'),
      );
      expect(categoryGroups.length).toBe(1);
    });

    it('renders article links for active section only', () => {
      const articleLinks = fixture.debugElement.queryAll(
        By.css('[data-testid="help-article-link"]'),
      );
      expect(articleLinks.length).toBe(2);
    });

    it('switches articles when active section changes', async () => {
      userRoleSignal.set('root_admin');
      fixture.componentRef.setInput('activeSection', 'admins');
      await fixture.whenStable();
      const articleLinks = fixture.debugElement.queryAll(
        By.css('[data-testid="help-article-link"]'),
      );
      expect(articleLinks.length).toBe(1);
      expect(
        (articleLinks[0].nativeElement as HTMLElement).textContent,
      ).toContain('Managing Events');
    });
  });

  describe('category index article', () => {
    it('renders an index link for categories that have an index article', async () => {
      userRoleSignal.set('root_admin');
      fixture.componentRef.setInput('activeSection', 'developers');
      fixture.componentRef.setInput('articles', [
        ...MOCK_ARTICLES,
        {
          slug: 'runbooks',
          title: 'Runbooks',
          category: 'Runbooks',
          order: 0,
          description: 'index',
          access: 'public',
          section: 'developers',
          body: '',
          isCategoryIndex: true,
        } as HelpArticle,
        {
          slug: 'runbooks-payments',
          title: 'Payments',
          category: 'Runbooks',
          order: 1,
          description: '',
          access: 'public',
          section: 'developers',
          body: '',
        } as HelpArticle,
      ]);
      await fixture.whenStable();

      const indexLinks = fixture.debugElement.queryAll(
        By.css('[data-testid="help-category-index-link"]'),
      );
      expect(indexLinks.length).toBe(1);
      expect(
        (indexLinks[0].nativeElement as HTMLElement).textContent?.trim(),
      ).toBe('Runbooks');
      const articleLinks = fixture.debugElement.queryAll(
        By.css('[data-testid="help-article-link"]'),
      );
      expect(articleLinks.length).toBe(2); // integration article + runbooks-payments
    });

    it('renders categories without an index article as a plain label', () => {
      const indexLinks = fixture.debugElement.queryAll(
        By.css('[data-testid="help-category-index-link"]'),
      );
      expect(indexLinks.length).toBe(0);
    });
  });

  describe('collapsible categories', () => {
    it('renders a toggle per category with aria-expanded true by default', () => {
      const toggles = fixture.debugElement.queryAll(
        By.css('[data-testid="help-category-toggle"]'),
      );
      expect(toggles.length).toBe(1);
      expect(
        (toggles[0].nativeElement as HTMLElement).getAttribute('aria-expanded'),
      ).toBe('true');
    });

    it('renders the toggle with a 24px hit area and an icon chevron', () => {
      const toggle = fixture.debugElement.query(
        By.css('[data-testid="help-category-toggle"]'),
      ).nativeElement as HTMLButtonElement;

      // h-6/w-6 = 24px — WCAG 2.2 AA minimum touch target
      expect(toggle.className).toContain('h-6');
      expect(toggle.className).toContain('w-6');
      expect(toggle.getAttribute('aria-label')).toContain('Collapse');

      const icon = fixture.debugElement.query(
        By.css('[data-testid="help-category-toggle"] z-icon'),
      );
      expect(icon).toBeTruthy();
      expect(toggle.textContent?.trim()).not.toContain('▸');
    });

    it('hides article links and flips aria-expanded when category toggled', async () => {
      const toggle = fixture.debugElement.query(
        By.css('[data-testid="help-category-toggle"]'),
      ).nativeElement as HTMLButtonElement;
      toggle.click();
      await fixture.whenStable();
      const articleLinks = fixture.debugElement.queryAll(
        By.css('[data-testid="help-article-link"]'),
      );
      expect(articleLinks.length).toBe(0);
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      const panels = fixture.debugElement.queryAll(
        By.css('[data-testid="help-category-panel"]'),
      );
      expect(panels.length).toBe(0);
    });
  });
});
