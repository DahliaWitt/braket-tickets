import {Injector} from '@angular/core';
import {Router} from '@angular/router';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const addIntegrationMock = vi.fn();
const browserTracingIntegrationMock = vi.fn(() => ({name: 'browserTracing'}));
const captureExceptionMock = vi.fn();
const createErrorHandlerMock = vi.fn();
const createFeedbackFormMock = vi.fn();
const handleErrorMock = vi.fn();
const initMock = vi.fn();
const lazyLoadIntegrationMock = vi.fn();
const getFeedbackMock = vi.fn();
const traceServiceConstructorMock = vi.fn();
class TraceServiceMock {
  constructor(router: Router) {
    traceServiceConstructorMock(router);
  }
}
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
  getFeedback: getFeedbackMock,
  init: initMock,
  lazyLoadIntegration: lazyLoadIntegrationMock,
  TraceService: TraceServiceMock,
}));

describe('sentry-loader', () => {
  beforeEach(() => {
    addIntegrationMock.mockReset();
    browserTracingIntegrationMock.mockClear();
    captureExceptionMock.mockReset();
    createFeedbackFormMock.mockReset();
    createErrorHandlerMock.mockReset();
    createErrorHandlerMock.mockReturnValue({
      handleError: handleErrorMock,
    });
    handleErrorMock.mockReset();
    initMock.mockReset();
    lazyLoadIntegrationMock.mockReset();
    getFeedbackMock.mockReset();
    traceServiceConstructorMock.mockReset();
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
    const {initializeSentryAngularTracing} = await import('./sentry-loader');
    const router = {};
    const injector = Injector.create({
      providers: [{provide: Router, useValue: router}],
    });

    await expect(
      initializeSentryAngularTracing(runtimeConfig, injector),
    ).resolves.toBeUndefined();

    expect(initMock).toHaveBeenCalledOnce();
    expect(traceServiceConstructorMock).toHaveBeenCalledWith(router);
  });

  it('lazy-loads replay when requested', async () => {
    const replayIntegrationFactory = vi.fn(() => ({name: 'replay'}));
    lazyLoadIntegrationMock.mockResolvedValue(replayIntegrationFactory);

    const {ensureSentryReplay} = await import('./sentry-loader');

    await expect(ensureSentryReplay(runtimeConfig)).resolves.toBeUndefined();
    expect(initMock).toHaveBeenCalledOnce();
    expect(lazyLoadIntegrationMock).toHaveBeenCalledWith('replayIntegration');
    expect(replayIntegrationFactory).toHaveBeenCalledWith({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    });
    expect(addIntegrationMock).toHaveBeenCalledOnce();
  });

  it('lazy-loads Sentry feedback and opens the provided form', async () => {
    const removeFromDom = vi.fn();
    const appendToDom = vi.fn();
    const open = vi.fn();
    const feedback = {
      createForm: createFeedbackFormMock.mockResolvedValue({
        appendToDom,
        open,
        removeFromDom,
      }),
    };
    const feedbackIntegrationFactory = vi.fn(() => ({name: 'feedback'}));
    lazyLoadIntegrationMock.mockResolvedValue(feedbackIntegrationFactory);
    getFeedbackMock
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(feedback);

    const {openSentryFeedback} = await import('./sentry-loader');

    await expect(openSentryFeedback(runtimeConfig)).resolves.toBe(true);

    expect(lazyLoadIntegrationMock).toHaveBeenCalledWith('feedbackIntegration');
    expect(feedbackIntegrationFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        autoInject: false,
        showBranding: false,
        showName: false,
        showEmail: true,
        enableScreenshot: true,
        formTitle: 'Feedback',
      }),
    );
    expect(addIntegrationMock).toHaveBeenCalledWith({name: 'feedback'});
    expect(createFeedbackFormMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: {
          source: 'footer_feedback',
        },
      }),
    );
    expect(appendToDom).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });

  it('does not load Sentry feedback when Sentry is disabled', async () => {
    runtimeConfig = {
      ...runtimeConfig,
      enableSentry: false,
      sentryDsn: '',
    };

    const {openSentryFeedback} = await import('./sentry-loader');

    await expect(openSentryFeedback(runtimeConfig)).resolves.toBe(false);
    expect(initMock).not.toHaveBeenCalled();
    expect(lazyLoadIntegrationMock).not.toHaveBeenCalled();
    expect(createFeedbackFormMock).not.toHaveBeenCalled();
  });

  it('captures exceptions through Sentry Angular error handling', async () => {
    const error = new Error('boom');
    const {handleSentryError} = await import('./sentry-loader');

    await expect(handleSentryError(error, runtimeConfig)).resolves.toBe(true);

    expect(createErrorHandlerMock).toHaveBeenCalledWith({
      showDialog: false,
      logErrors: false,
    });
    expect(handleErrorMock).toHaveBeenCalledWith(error);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('reports when Sentry Angular error handling fails', async () => {
    const error = new Error('boom');
    createErrorHandlerMock.mockImplementation(() => {
      throw new Error('handler setup failed');
    });
    const {handleSentryError} = await import('./sentry-loader');

    await expect(handleSentryError(error, runtimeConfig)).resolves.toBe(false);
    expect(createErrorHandlerMock).toHaveBeenCalledOnce();
    expect(handleErrorMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('does not construct a Sentry error handler when disabled', async () => {
    runtimeConfig = {
      ...runtimeConfig,
      enableSentry: false,
      sentryDsn: '',
    };
    const {handleSentryError} = await import('./sentry-loader');

    await expect(
      handleSentryError(new Error('boom'), runtimeConfig),
    ).resolves.toBe(false);

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
    const {initializeSentryAngularTracing} = await import('./sentry-loader');
    const injector = Injector.create({
      providers: [],
    });

    await expect(
      initializeSentryAngularTracing(runtimeConfig, injector),
    ).resolves.toBeUndefined();

    expect(initMock).not.toHaveBeenCalled();
    expect(traceServiceConstructorMock).not.toHaveBeenCalled();
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
