import {
  type ErrorHandler,
  inject,
  type Injector,
  runInInjectionContext,
} from '@angular/core';
import {Router} from '@angular/router';
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

/**
 * Determines whether Sentry reporting is enabled for the given runtime config.
 *
 * @param config - Runtime Sentry configuration
 * @returns `true` if `config.enableSentry` is truthy and `config.sentryDsn` is not an empty string, `false` otherwise.
 */
export function isSentryEnabled(config: SentryRuntimeConfig): boolean {
  return config.enableSentry && config.sentryDsn !== '';
}

/**
 * Lazily loads the `@sentry/angular` module and caches the import for reuse.
 *
 * @returns The imported `@sentry/angular` module
 */
function loadSentry(): Promise<SentryModule> {
  sentryLoadPromise ??= import('@sentry/angular');
  return sentryLoadPromise;
}

/**
 * Initialize and configure the Sentry SDK using the provided runtime config.
 *
 * Initializes Sentry (lazily loading the `@sentry/angular` module) and applies configuration
 * such as DSN, environment, tracing, and replay sampling based on `config`. If Sentry is
 * disabled by the runtime configuration, no initialization is performed.
 *
 * @param config - Runtime Sentry configuration controlling DSN, environment, tracing, and replay options
 * @returns `SentryModule` if Sentry was initialized, `null` if Sentry is disabled
 */
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

/**
 * Ensures Sentry is initialized and registers its TraceService in the provided Angular injector.
 *
 * If Sentry is not enabled, this function returns without side effects. Initialization errors propagate to the caller.
 *
 * @param config - Runtime Sentry configuration controlling initialization and replay behavior
 * @param injector - Angular injector used to register Sentry.TraceService into the DI context
 */
export async function initializeSentryAngularTracing(
  config: SentryRuntimeConfig,
  injector: Injector,
): Promise<void> {
  const Sentry = await initializeSentry(config);
  if (!Sentry) {
    return;
  }

  runInInjectionContext(injector, () => {
    new Sentry.TraceService(inject(Router));
  });
}

/**
 * Get a cached Sentry ErrorHandler when Sentry is enabled and initialized.
 *
 * @param config - Runtime Sentry configuration used to determine whether Sentry should be initialized
 * @returns An Angular `ErrorHandler` created by Sentry, or `null` if Sentry is disabled or initialization yielded no Sentry module
 */
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

/**
 * Captures an error with Sentry using the configured error handler.
 *
 * @param error - The error or value to report to Sentry.
 * @param config - Runtime Sentry configuration that controls whether Sentry is enabled and how reporting is performed.
 * @returns `true` when the error was reported to Sentry, `false` when Sentry is disabled or reporting failed.
 */
export async function handleSentryError(
  error: unknown,
  config: SentryRuntimeConfig,
): Promise<boolean> {
  try {
    const errorHandler = await getSentryErrorHandler(config);
    if (!errorHandler) {
      return false;
    }

    errorHandler.handleError(error);
    return true;
  } catch (captureError: unknown) {
    logger.error('Failed to capture Sentry exception', captureError);
    return false;
  }
}

/**
 * Ensures the Sentry Replay integration is loaded and registered when Sentry is enabled.
 *
 * @param config - Runtime Sentry configuration used to initialize Sentry and decide whether replay should be loaded
 * @throws Any error encountered while lazy-loading or registering the replay integration; on failure the load attempt is reset so it can be retried later
 */
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
    Sentry.addIntegration(
      replayIntegration({
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    );
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
    void ensureSentryReplay(config).catch(() => {
      // ensureSentryReplay already logs and resets the retry state. Keep this
      // optional integration failure out of the global unhandled-error path.
    });
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(() => startReplay(), {timeout: 5_000});
    return;
  }

  globalThis.setTimeout(startReplay, 5_000);
}
