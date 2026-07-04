import {
  type ApplicationConfig,
  ErrorHandler,
  inject,
  provideEnvironmentInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {DOCUMENT, IMAGE_CONFIG, IMAGE_LOADER} from '@angular/common';
import {provideHttpClient, withXhr} from '@angular/common/http';
import {braketImageLoaderFactory} from './core/image-loader/braket-image-loader';
import {
  provideRouter,
  Router,
  withComponentInputBinding,
  withInMemoryScrolling,
  withRouterConfig,
  withViewTransitions,
} from '@angular/router';
import {provideConvex, provideConvexAuthFromExisting} from 'convex-angular';

import {routes} from './app.routes';
import {environment} from '../environments/environment';
import {provideBra} from '@ui/core/provider/provide-bra';
import {STRIPE_CONFIG} from './app.tokens';
import {withChunkErrorRecovery} from './core/error-handling/chunk-error-recovery';
import {AppErrorHandler} from './core/error-handling/app-error-handler';
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
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled',
      }),
      withRouterConfig({
        onSameUrlNavigation: 'reload',
        // Angular 22 flips the default to 'always'. Pin the v21 behavior so
        // child routes do not silently inherit parent params after upgrade.
        paramsInheritanceStrategy: 'emptyOnly',
      }),
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
    provideHttpClient(withXhr()),
    provideBra(),
    {provide: STRIPE_CONFIG, useValue: environment.stripe},
    {provide: IMAGE_LOADER, useFactory: braketImageLoaderFactory},
    {
      provide: IMAGE_CONFIG,
      useValue: {breakpoints: [320, 640, 1024, 1600]},
    },
    provideEnvironmentInitializer(() => {
      inject(AuthService);
    }),
    {
      provide: ErrorHandler,
      useFactory: () =>
        withChunkErrorRecovery(
          inject(AppErrorHandler),
          inject(BrowserPlatformService),
        ),
    },
  ],
};
