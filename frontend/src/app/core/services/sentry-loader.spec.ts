import {beforeEach, describe, expect, it, vi} from 'vitest';

const addIntegrationMock = vi.fn();
const lazyLoadIntegrationMock = vi.fn();
let runtimeConfig = {
  enableSentry: true,
  sentryDsn: 'https://examplePublicKey@o0.ingest.us.sentry.io/0',
  enableSentryReplay: true,
};

vi.mock('@sentry/angular', () => ({
  addIntegration: addIntegrationMock,
  lazyLoadIntegration: lazyLoadIntegrationMock,
}));

describe('sentry-loader', () => {
  beforeEach(() => {
    addIntegrationMock.mockReset();
    lazyLoadIntegrationMock.mockReset();
    runtimeConfig = {
      enableSentry: true,
      sentryDsn: 'https://examplePublicKey@o0.ingest.us.sentry.io/0',
      enableSentryReplay: true,
    };
    (window as unknown as Record<string, unknown>).requestIdleCallback =
      undefined;
    delete (window as unknown as Record<string, unknown>).requestIdleCallback;
    vi.resetModules();
  });

  it('skips loading optional integrations when Sentry is disabled', async () => {
    runtimeConfig = {
      ...runtimeConfig,
      enableSentry: false,
      sentryDsn: '',
    };

    const {ensureSentryReplay} = await import('./sentry-loader');

    await expect(ensureSentryReplay(runtimeConfig)).resolves.toBeUndefined();
    expect(lazyLoadIntegrationMock).not.toHaveBeenCalled();
    expect(addIntegrationMock).not.toHaveBeenCalled();
  });

  it('lazy-loads replay when requested', async () => {
    lazyLoadIntegrationMock.mockResolvedValue(() => ({name: 'replay'}));

    const {ensureSentryReplay} = await import('./sentry-loader');

    await expect(ensureSentryReplay(runtimeConfig)).resolves.toBeUndefined();
    expect(lazyLoadIntegrationMock).toHaveBeenCalledWith('replayIntegration');
    expect(addIntegrationMock).toHaveBeenCalledOnce();
  });

  it('schedules replay loading during browser idle time', async () => {
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      callback({
        didTimeout: false,
        timeRemaining: () => 42,
      } as IdleDeadline);
      return 1;
    });

    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      writable: true,
      value: requestIdleCallback,
    });
    lazyLoadIntegrationMock.mockResolvedValue(() => ({name: 'replay'}));

    const {scheduleSentryReplayLoad} = await import('./sentry-loader');

    scheduleSentryReplayLoad(runtimeConfig);

    expect(requestIdleCallback).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(lazyLoadIntegrationMock).toHaveBeenCalledWith('replayIntegration'),
    );
  });
});
