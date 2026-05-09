import type {ApplicationRef} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {appConfig} from './app/app.config';
import {App} from './app/app';
import {
  initializeSentryAngularTracing,
  isSentryEnabled,
  scheduleSentryReplayLoad,
} from './app/core/services/sentry-loader';
import {environment} from './environments/environment';

if (environment.production) {
  // Intentional logger bypass: this is a production easter egg, not an app log.
  console.log(
    '%cLEAVE MY DUMPSTER FIRE ALONEEEEE',
    'color: #f43f5e; font-size: 50px; font-weight: bold; text-shadow: 2px 2px 0px #000; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;',
  );
}

function scheduleMonitoringLoad(appRef: ApplicationRef): void {
  if (typeof window === 'undefined' || !isSentryEnabled(environment)) {
    return;
  }

  const startMonitoring = () => {
    void initializeSentryAngularTracing(environment, appRef.injector)
      .then(() => {
        scheduleSentryReplayLoad(environment);
      })
      .catch((error: unknown) => {
        console.error('Failed to initialize Sentry monitoring', error);
      });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => startMonitoring(), {timeout: 5_000});
    return;
  }

  globalThis.setTimeout(startMonitoring, 5_000);
}

bootstrapApplication(App, appConfig)
  .then((appRef) => {
    scheduleMonitoringLoad(appRef);
  })
  .catch((err) => console.error(err));
