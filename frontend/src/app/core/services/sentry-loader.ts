import {
  type ErrorHandler,
  inject,
  type Injector,
  runInInjectionContext,
} from '@angular/core';
import {logger} from '@/utils/logger';
import type {AppEnvironment} from '../../../environments/environment.model';
import type * as SentryAngular from '@sentry/angular';

export type SentryRuntimeConfig = Pick<
  AppEnvironment,
  | 'enableSentry'
  | 'sentryDsn'
  | 'enableSentryReplay'
  | 'sentryEnvironment'
  | 'sentryReplaySessionSampleRate'
  | 'sentryReplayOnErrorSampleRate'
>;

type SentryModule = typeof SentryAngular;

let sentryLoadPromise: Promise<SentryModule> | null = null;
let sentryInitPromise: Promise<SentryModule> | null = null;
let sentryErrorHandlerPromise: Promise<ErrorHandler | null> | null = null;
let replayLoadPromise: Promise<void> | null = null;
let replayScheduled = false;

export function isSentryEnabled(config: SentryRuntimeConfig): boolean {
  return config.enableSentry && config.sentryDsn !== '';
}

function loadSentry(): Promise<SentryModule> {
  sentryLoadPromise ??= import('@sentry/angular');
  return sentryLoadPromise;
}

export async function initializeSentry(
  config: SentryRuntimeConfig,
): Promise<SentryModule | null> {
  if (!isSentryEnabled(config)) {
    return null;
  }

  sentryInitPromise ??= loadSentry().then((Sentry) => {
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment,
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
      replaysSessionSampleRate: config.enableSentryReplay
        ? config.sentryReplaySessionSampleRate
        : 0,
      replaysOnErrorSampleRate: config.enableSentryReplay
        ? config.sentryReplayOnErrorSampleRate
        : 0,
      // Send 100% of errors
      sampleRate: 1.0,
      // Don't send PII like user IPs
      sendDefaultPii: false,
    });

    return Sentry;
  });

  return sentryInitPromise;
}

export async function initializeSentryAngularTracing(
  config: SentryRuntimeConfig,
  injector: Injector,
): Promise<void> {
  const Sentry = await initializeSentry(config);
  if (!Sentry) {
    return;
  }

  runInInjectionContext(injector, () => {
    inject(Sentry.TraceService);
  });
}

async function getSentryErrorHandler(
  config: SentryRuntimeConfig,
): Promise<ErrorHandler | null> {
  if (!isSentryEnabled(config)) {
    return null;
  }

  sentryErrorHandlerPromise ??= initializeSentry(config).then((Sentry) => {
    if (!Sentry) {
      return null;
    }

    return Sentry.createErrorHandler({
      showDialog: false,
      logErrors: false,
    });
  });

  return sentryErrorHandlerPromise;
}

export function handleSentryError(
  error: unknown,
  config: SentryRuntimeConfig,
): void {
  void getSentryErrorHandler(config)
    .then((errorHandler) => {
      errorHandler?.handleError(error);
    })
    .catch((captureError: unknown) => {
      logger.error('Failed to capture Sentry exception', captureError);
    });
}

export async function ensureSentryReplay(
  config: SentryRuntimeConfig,
): Promise<void> {
  if (!isSentryEnabled(config)) {
    return;
  }

  replayLoadPromise ??= (async () => {
    const Sentry = await initializeSentry(config);
    if (!Sentry) {
      return;
    }

    const replayIntegration =
      await Sentry.lazyLoadIntegration('replayIntegration');
    Sentry.addIntegration(replayIntegration());
  })().catch((error: unknown) => {
    replayLoadPromise = null;
    logger.error('Failed to lazy-load Sentry replay integration', error);
    throw error;
  });

  await replayLoadPromise;
}

export function scheduleSentryReplayLoad(config: SentryRuntimeConfig): void {
  if (
    replayScheduled ||
    typeof window === 'undefined' ||
    !isSentryEnabled(config) ||
    !config.enableSentryReplay
  ) {
    return;
  }

  replayScheduled = true;

  const startReplay = () => {
    void ensureSentryReplay(config);
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => startReplay(), {timeout: 5_000});
    return;
  }

  globalThis.setTimeout(startReplay, 5_000);
}
