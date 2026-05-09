import {
  type ApplicationConfig,
  ErrorHandler,
  inject,
  provideEnvironmentInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {DOCUMENT} from '@angular/common';
import {provideHttpClient} from '@angular/common/http';
import {
  provideRouter,
  Router,
  withComponentInputBinding,
  withRouterConfig,
  withViewTransitions,
} from '@angular/router';
import * as Sentry from '@sentry/angular';
import {provideConvex, provideConvexAuthFromExisting} from 'convex-angular';

import {routes} from './app.routes';
import {environment} from '../environments/environment';
import {provideBra} from '@ui/core/provider/provide-bra';
import {STRIPE_CONFIG} from './app.tokens';
import {withChunkErrorRecovery} from './core/error-handling/chunk-error-recovery';
import {GlobalErrorHandler} from './core/error-handling/global-error-handler';
import {AuthService} from './core/services/auth.service';
import {BrowserPlatformService} from './core/services/browser-platform.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideBrowserGlobalErrorListeners(),
    provideConvex(environment.convexUrl),
    provideConvexAuthFromExisting(AuthService),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withRouterConfig({onSameUrlNavigation: 'reload'}),
      withViewTransitions({
        onViewTransitionCreated: ({transition}) => {
          const router = inject(Router);
          const doc = inject(DOCUMENT);
          const nav = router.currentNavigation();
          const isBack = nav?.trigger === 'popstate';

          // Once a view transition fires, component-level animate-in
          // classes are redundant — the crossfade handles the entrance.
          // Set once, never remove: removing re-triggers CSS animations.
          doc.documentElement.setAttribute('data-nav-transition', '');

          // Back/forward: skip the crossfade entirely — returning to
          // a known page should feel instant.
          if (isBack) {
            transition.skipTransition();
          }
        },
      }),
    ),
    provideHttpClient(),
    provideBra(),
    {provide: STRIPE_CONFIG, useValue: environment.stripe},
    provideEnvironmentInitializer(() => {
      inject(AuthService);
    }),
    // Sentry error tracking (only active when enabled and DSN is configured)
    ...(environment.enableSentry && environment.sentryDsn
      ? [
          {
            provide: ErrorHandler,
            useFactory: () =>
              withChunkErrorRecovery(
                Sentry.createErrorHandler({showDialog: false}),
                inject(BrowserPlatformService),
              ),
          },
          {
            provide: Sentry.TraceService,
            deps: [Router],
          },
        ]
      : [
          GlobalErrorHandler,
          {
            provide: ErrorHandler,
            useFactory: () =>
              withChunkErrorRecovery(
                inject(GlobalErrorHandler),
                inject(BrowserPlatformService),
              ),
          },
        ]),
  ],
};
