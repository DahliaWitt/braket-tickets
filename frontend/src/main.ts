import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { scheduleSentryReplayLoad } from './app/core/services/sentry-loader';
import { environment } from './environments/environment';

// Initialize Sentry error tracking (only when enabled and DSN is configured)
if (environment.enableSentry && environment.sentryDsn) {
  Sentry.init({
    dsn: environment.sentryDsn,
    environment: environment.sentryEnvironment,
    tunnel: '/monitor',
    integrations: [Sentry.browserTracingIntegration()],
    // Restrict trace header propagation to our own backend origins only.
    // Without this, Sentry would add sentry-trace/baggage headers to ALL
    // outbound requests, potentially leaking trace context to third parties.
    tracePropagationTargets: [
      /^https:\/\/.*\.convex\.cloud/,
      /^https?:\/\/localhost/,
      /^https?:\/\/127\.0\.0\.1/,
    ],
    // Capture 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: environment.enableSentryReplay
      ? environment.sentryReplaySessionSampleRate
      : 0,
    replaysOnErrorSampleRate: environment.enableSentryReplay
      ? environment.sentryReplayOnErrorSampleRate
      : 0,
    // Send 100% of errors
    sampleRate: 1.0,
    // Don't send PII like user IPs
    sendDefaultPii: false,
  });
}
if (environment.production) {
  // Intentional logger bypass: this is a production easter egg, not an app log.
  console.log(
    '%cLEAVE MY DUMPSTER FIRE ALONEEEEE',
    'color: #f43f5e; font-size: 50px; font-weight: bold; text-shadow: 2px 2px 0px #000; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;',
  );
}

bootstrapApplication(App, appConfig)
  .then(() => {
    scheduleSentryReplayLoad(environment);
  })
  .catch((err) => console.error(err));
