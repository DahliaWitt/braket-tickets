import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  Router,
  RouterOutlet,
  provideRouter,
  type Routes,
  withComponentInputBinding,
} from '@angular/router';
import type { Meta, StoryObj } from '@storybook/angular';
import { applicationConfig } from '@storybook/angular';

import { AuthService } from '@/core/services/auth.service';

import { HelpShellComponent } from './help-shell.component';
import { HelpManifestService } from '../../services/help-manifest.service';
import { HelpSearchService } from '../../services/help-search.service';
import { SectionLandingComponent } from '../section-landing/section-landing.component';
import { type HelpArticle, type HelpAccessLevel } from '../../models/help.models';

type HelpShellStoryRole = 'root_admin' | 'community_admin' | 'user';
type HelpShellStoryUserRole = HelpShellStoryRole | undefined;

interface HelpShellStoryState {
  articles: HelpArticle[];
  loadError: boolean;
  role: HelpShellStoryRole;
  authenticated: boolean;
  targetUrl: string;
}

const helpShellStoryState = signal<HelpShellStoryState>({
  articles: [],
  loadError: false,
  role: 'community_admin',
  authenticated: true,
  targetUrl: '/help/users',
});

const USERS_ARTICLES: HelpArticle[] = [
  {
    slug: 'getting-started',
    title: 'Getting Started',
    category: 'Basics',
    order: 1,
    description: 'How to get set up and find your first event.',
    access: 'public',
    section: 'users',
    body: 'Welcome to the help center. Start here when you are new to the platform.',
  },
  {
    slug: 'buying-tickets',
    title: 'Buying Tickets',
    category: 'Tickets',
    order: 1,
    description: 'Ticket flow, payment options, and what happens after checkout.',
    access: 'public',
    section: 'users',
    body: 'Learn how to purchase tickets, manage your order, and check your confirmation.',
  },
  {
    slug: 'transferring-orders',
    title: 'Transferring Orders',
    category: 'Tickets',
    order: 2,
    description: 'How ticket transfers work for organizers and guests.',
    access: 'authenticated',
    section: 'users',
    body: 'Transfer orders to another guest when the event permits it.',
  },
  {
    slug: 'account-setup',
    title: 'Account Setup',
    category: 'Account',
    order: 1,
    description: 'Profile and account basics for signed-in guests.',
    access: 'authenticated',
    section: 'users',
    body: 'Keep your profile details current and manage your notifications.',
  },
];

const ADMIN_ARTICLES: HelpArticle[] = [
  {
    slug: 'moderation-overview',
    title: 'Moderation Overview',
    category: 'Operations',
    order: 1,
    description: 'Review submissions, approvals, and safe publishing workflows.',
    access: 'community_admin',
    section: 'admins',
    body: 'Use the moderation queue to review pending applications and event changes.',
  },
  {
    slug: 'magic-links',
    title: 'Magic Links',
    category: 'Access',
    order: 1,
    description: 'Generate and manage one-click entry links for guests.',
    access: 'community_admin',
    section: 'admins',
    body: 'Magic links are a fast path into the help and access workflow for trusted guests.',
  },
  {
    slug: 'system-settings',
    title: 'System Settings',
    category: 'Configuration',
    order: 1,
    description: 'Account-level settings reserved for root admins.',
    access: 'root_admin',
    section: 'admins',
    body: 'Root admins can change platform-wide defaults and operational settings.',
  },
];

const STORY_ARTICLES: HelpArticle[] = [...USERS_ARTICLES, ...ADMIN_ARTICLES];

const STORY_ROUTES: Routes = [
  {
    path: 'help',
    component: HelpShellComponent,
    children: [
      { path: '', redirectTo: 'users', pathMatch: 'full' },
      { path: ':section', component: SectionLandingComponent },
      { path: '**', redirectTo: 'users' },
    ],
  },
  { path: '**', redirectTo: 'help/users' },
];

class StoryHelpManifestService {
  private readonly articles = signal<HelpArticle[]>([]);

  loadManifest(): Promise<HelpArticle[]> {
    const state = helpShellStoryState();
    if (state.loadError) {
      this.articles.set([]);
      return Promise.reject(new Error('Storybook help manifest failed to load'));
    }

    this.articles.set(state.articles);
    return Promise.resolve(state.articles);
  }

  getArticlesBySection(section: HelpArticle['section']): HelpArticle[] {
    return this.articles().filter((article) => article.section === section);
  }

  getCategoriesForSection(section: HelpArticle['section']) {
    const articles = this.getArticlesBySection(section);
    const categoryMap = new Map<string, HelpArticle[]>();
    for (const article of articles) {
      const existing = categoryMap.get(article.category) ?? [];
      existing.push(article);
      categoryMap.set(article.category, existing);
    }
    return Array.from(categoryMap.entries()).map(([name, items]) => ({
      name,
      articles: items.toSorted((a, b) => a.order - b.order),
    }));
  }

  getArticle(section: HelpArticle['section'], slug: string): HelpArticle | undefined {
    return this.articles().find((article) => article.section === section && article.slug === slug);
  }

  getArticleAccess(article: HelpArticle): HelpAccessLevel {
    return article.access ?? 'public';
  }

  getAccessibleArticles(userRole: HelpShellStoryUserRole): HelpArticle[] {
    return this.articles().filter((article) => this.canAccess(article, userRole));
  }

  canAccess(article: HelpArticle, userRole: HelpShellStoryUserRole): boolean {
    const access = this.getArticleAccess(article);
    if (access === 'public') return true;
    if (access === 'authenticated') return true;
    if (access === 'community_admin')
      return userRole === 'community_admin' || userRole === 'root_admin';
    return userRole === 'root_admin';
  }
}

class StoryAuthService {
  isAuthenticated(): boolean {
    return helpShellStoryState().authenticated;
  }

  userRole(): HelpShellStoryRole {
    return helpShellStoryState().role;
  }
}

@Component({
  selector: 'bt-story-help-shell-route-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
class HelpShellStoryRouteHostComponent {
  private readonly router = inject(Router);

  ngOnInit(): void {
    void this.router.navigateByUrl(helpShellStoryState().targetUrl, { replaceUrl: true });
  }
}

function setHelpShellStoryState(state: Partial<HelpShellStoryState>): void {
  helpShellStoryState.update((current) => ({
    ...current,
    ...state,
  }));
}

const meta: Meta<HelpShellComponent> = {
  title: 'Braket/Archetypes/HelpShell',
  component: HelpShellComponent,
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [
        provideRouter(STORY_ROUTES, withComponentInputBinding()),
        { provide: HelpManifestService, useClass: StoryHelpManifestService },
        { provide: HelpSearchService, useClass: HelpSearchService },
        { provide: AuthService, useClass: StoryAuthService },
      ],
    }),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Real help shell imported into Storybook. The stories drive the actual router outlet with story-local manifest and auth data so the sidebar, search, and section landing states match app behavior.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<HelpShellComponent>;

function renderHelpShellStory() {
  return {
    template: `<bt-story-help-shell-route-host />`,
    moduleMetadata: { imports: [HelpShellStoryRouteHostComponent] },
  };
}

export const UsersGuide: Story = {
  render: () => {
    setHelpShellStoryState({
      articles: STORY_ARTICLES,
      loadError: false,
      role: 'community_admin',
      authenticated: true,
      targetUrl: '/help/users',
    });
    return renderHelpShellStory();
  },
};

export const MobileUsersGuide: Story = {
  render: () => {
    setHelpShellStoryState({
      articles: STORY_ARTICLES,
      loadError: false,
      role: 'community_admin',
      authenticated: true,
      targetUrl: '/help/users',
    });
    return renderHelpShellStory();
  },
  parameters: {
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
};

export const AdminGuide: Story = {
  render: () => {
    setHelpShellStoryState({
      articles: STORY_ARTICLES,
      loadError: false,
      role: 'root_admin',
      authenticated: true,
      targetUrl: '/help/admins',
    });
    return renderHelpShellStory();
  },
};

export const LoadError: Story = {
  render: () => {
    setHelpShellStoryState({
      articles: STORY_ARTICLES,
      loadError: true,
      role: 'community_admin',
      authenticated: true,
      targetUrl: '/help/users',
    });
    return renderHelpShellStory();
  },
};
