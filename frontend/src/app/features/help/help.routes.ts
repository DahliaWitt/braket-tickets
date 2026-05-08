import { type Routes, type CanMatchFn } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { provideMarkdown } from 'ngx-markdown';
import { inject } from '@angular/core';
import { AuthService } from '@/core/services/auth.service';
import { HelpShellComponent } from './pages/help-shell/help-shell.component';
import { HelpManifestService } from './services/help-manifest.service';
import { HelpSearchService } from './services/help-search.service';

const HELP_VALID_SECTIONS = new Set(['users', 'admins', 'developers']);

const helpSectionGuard: CanMatchFn = (_route, segments) => {
  const section = segments[0]?.path;
  if (!section || !HELP_VALID_SECTIONS.has(section)) {
    return false;
  }

  if (section === 'admins') {
    const auth = inject(AuthService);
    const role = auth.userRole();
    return role === 'root_admin' || role === 'community_admin';
  }

  return true;
};

export const HELP_ROUTES: Routes = [
  {
    path: '',
    component: HelpShellComponent,
    providers: [HelpManifestService, HelpSearchService, provideMarkdown({ loader: HttpClient })],
    children: [
      { path: '', redirectTo: 'users', pathMatch: 'full' },
      {
        path: ':section',
        canMatch: [helpSectionGuard],
        loadComponent: () =>
          import('./pages/section-landing/section-landing.component').then(
            (m) => m.SectionLandingComponent,
          ),
      },
      {
        path: ':section/:slug',
        canMatch: [helpSectionGuard],
        loadComponent: () =>
          import('./pages/article/article.component').then((m) => m.ArticleComponent),
      },
    ],
  },
];
