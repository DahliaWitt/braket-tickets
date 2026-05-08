import * as Sentry from '@sentry/angular';
import {logger} from '@/utils/logger';
import type {AppEnvironment} from '../../../environments/environment.model';

export type SentryRuntimeConfig = Pick<
  AppEnvironment,
  'enableSentry' | 'sentryDsn' | 'enableSentryReplay'
>;

let replayLoadPromise: Promise<void> | null = null;
let replayScheduled = false;

function isSentryEnabled(config: SentryRuntimeConfig): boolean {
  return config.enableSentry && config.sentryDsn !== '';
}

export async function ensureSentryReplay(
  config: SentryRuntimeConfig,
): Promise<void> {
  if (!isSentryEnabled(config)) {
    return;
  }

  replayLoadPromise ??= (async () => {
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
