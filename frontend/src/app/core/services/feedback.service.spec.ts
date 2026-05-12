import {afterEach, describe, expect, it, vi} from 'vitest';

interface FeedbackRuntimeConfig {
  enableSentry: boolean;
  sentryDsn: string;
}

describe('FeedbackService', () => {
  afterEach(() => {
    vi.doUnmock('./sentry-loader');
    vi.resetModules();
  });

  it('opens Sentry feedback with the runtime environment', async () => {
    const openSentryFeedback = vi
      .fn<(config: FeedbackRuntimeConfig) => Promise<boolean>>()
      .mockResolvedValue(true);
    vi.doMock('./sentry-loader', () => ({
      openSentryFeedback,
    }));

    const {FeedbackService} = await import('./feedback.service');
    const service = new FeedbackService();

    await expect(service.open()).resolves.toBe(true);
    const [config] = openSentryFeedback.mock.calls[0] ?? [];
    expect(typeof config?.enableSentry).toBe('boolean');
    expect(typeof config?.sentryDsn).toBe('string');
  });
});
