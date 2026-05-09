import {Injector} from '@angular/core';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const addIntegrationMock = vi.fn();
const browserTracingIntegrationMock = vi.fn(() => ({name: 'browserTracing'}));
const captureExceptionMock = vi.fn();
const createErrorHandlerMock = vi.fn();
const handleErrorMock = vi.fn();
const initMock = vi.fn();
const lazyLoadIntegrationMock = vi.fn();
class TraceServiceMock {}
let runtimeConfig = {
  enableSentry: true,
  sentryDsn: 'https://examplePublicKey@o0.ingest.us.sentry.io/0',
  enableSentryReplay: true,
  sentryEnvironment: 'test',
  sentryReplaySessionSampleRate: 0.1,
  sentryReplayOnErrorSampleRate: 1,
};

vi.mock('@sentry/angular', () => ({
  addIntegration: addIntegrationMock,
  browserTracingIntegration: browserTracingIntegrationMock,
  captureException: captureExceptionMock,
  createErrorHandler: createErrorHandlerMock,
  init: initMock,
  lazyLoadIntegration: lazyLoadIntegrationMock,
  TraceService: TraceServiceMock,
}));

describe('sentry-loader', () => {
  beforeEach(() => {
    addIntegrationMock.mockReset();
    browserTracingIntegrationMock.mockClear();
    captureExceptionMock.mockReset();
    createErrorHandlerMock.mockReset();
    createErrorHandlerMock.mockReturnValue({
      handleError: handleErrorMock,
    });
    handleErrorMock.mockReset();
    initMock.mockReset();
    lazyLoadIntegrationMock.mockReset();
    runtimeConfig = {
      enableSentry: true,
      sentryDsn: 'https://examplePublicKey@o0.ingest.us.sentry.io/0',
      enableSentryReplay: true,
      sentryEnvironment: 'test',
      sentryReplaySessionSampleRate: 0.1,
      sentryReplayOnErrorSampleRate: 1,
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
    expect(initMock).not.toHaveBeenCalled();
    expect(lazyLoadIntegrationMock).not.toHaveBeenCalled();
    expect(addIntegrationMock).not.toHaveBeenCalled();
  });

  it('initializes Sentry lazily when enabled', async () => {
    const {initializeSentry} = await import('./sentry-loader');

    await expect(initializeSentry(runtimeConfig)).resolves.toBeTruthy();

    expect(initMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: runtimeConfig.sentryDsn,
        environment: 'test',
        tunnel: '/monitor',
        tracesSampleRate: 0.1,
      }),
    );
    expect(browserTracingIntegrationMock).toHaveBeenCalledOnce();
  });

  it('starts Angular route tracing through TraceService injection', async () => {
    const traceServiceFactory = vi.fn(() => ({}));
    const {initializeSentryAngularTracing} = await import('./sentry-loader');
    const Sentry = await import('@sentry/angular');
    const injector = Injector.create({
      providers: [
        {
          provide: Sentry.TraceService,
          useFactory: traceServiceFactory,
        },
      ],
    });

    await expect(
      initializeSentryAngularTracing(runtimeConfig, injector),
    ).resolves.toBeUndefined();

    expect(initMock).toHaveBeenCalledOnce();
    expect(traceServiceFactory).toHaveBeenCalledOnce();
  });

  it('lazy-loads replay when requested', async () => {
    lazyLoadIntegrationMock.mockResolvedValue(() => ({name: 'replay'}));

    const {ensureSentryReplay} = await import('./sentry-loader');

    await expect(ensureSentryReplay(runtimeConfig)).resolves.toBeUndefined();
    expect(initMock).toHaveBeenCalledOnce();
    expect(lazyLoadIntegrationMock).toHaveBeenCalledWith('replayIntegration');
    expect(addIntegrationMock).toHaveBeenCalledOnce();
  });

  it('captures exceptions through Sentry Angular error handling', async () => {
    const error = new Error('boom');
    const {handleSentryError} = await import('./sentry-loader');

    handleSentryError(error, runtimeConfig);

    await vi.waitFor(() =>
      expect(createErrorHandlerMock).toHaveBeenCalledWith({
        showDialog: false,
        logErrors: false,
      }),
    );
    expect(handleErrorMock).toHaveBeenCalledWith(error);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('does not construct a Sentry error handler when disabled', async () => {
    runtimeConfig = {
      ...runtimeConfig,
      enableSentry: false,
      sentryDsn: '',
    };
    const {handleSentryError} = await import('./sentry-loader');

    handleSentryError(new Error('boom'), runtimeConfig);

    await new Promise((resolve) => globalThis.setTimeout(resolve));
    expect(createErrorHandlerMock).not.toHaveBeenCalled();
    expect(handleErrorMock).not.toHaveBeenCalled();
    expect(initMock).not.toHaveBeenCalled();
  });

  it('skips Angular route tracing when Sentry is disabled', async () => {
    runtimeConfig = {
      ...runtimeConfig,
      enableSentry: false,
      sentryDsn: '',
    };
    const traceServiceFactory = vi.fn(() => ({}));
    const {initializeSentryAngularTracing} = await import('./sentry-loader');
    const Sentry = await import('@sentry/angular');
    const injector = Injector.create({
      providers: [
        {
          provide: Sentry.TraceService,
          useFactory: traceServiceFactory,
        },
      ],
    });

    await expect(
      initializeSentryAngularTracing(runtimeConfig, injector),
    ).resolves.toBeUndefined();

    expect(initMock).not.toHaveBeenCalled();
    expect(traceServiceFactory).not.toHaveBeenCalled();
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
