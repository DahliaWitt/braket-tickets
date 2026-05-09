import {TestBed} from '@angular/core/testing';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {AppErrorHandler} from './app-error-handler';
import {GlobalErrorHandler} from './global-error-handler';

const sentryLoaderMocks = vi.hoisted(() => ({
  handleSentryError: vi.fn(),
  isSentryEnabled: vi.fn(),
}));

vi.mock('../services/sentry-loader', () => sentryLoaderMocks);

vi.mock('@/utils/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('AppErrorHandler', () => {
  const globalErrorHandler = {
    handleError: vi.fn(),
  };

  beforeEach(() => {
    sentryLoaderMocks.handleSentryError.mockReset();
    sentryLoaderMocks.isSentryEnabled.mockReset();
    globalErrorHandler.handleError.mockReset();
    TestBed.configureTestingModule({
      providers: [
        AppErrorHandler,
        {provide: GlobalErrorHandler, useValue: globalErrorHandler},
      ],
    });
  });

  it('delegates to the global handler when Sentry is disabled', () => {
    const error = new Error('boom');
    sentryLoaderMocks.isSentryEnabled.mockReturnValue(false);

    TestBed.inject(AppErrorHandler).handleError(error);

    expect(globalErrorHandler.handleError).toHaveBeenCalledWith(error);
    expect(sentryLoaderMocks.handleSentryError).not.toHaveBeenCalled();
  });

  it('does not show the global fallback when Sentry handles the error', async () => {
    const error = new Error('boom');
    sentryLoaderMocks.isSentryEnabled.mockReturnValue(true);
    sentryLoaderMocks.handleSentryError.mockResolvedValue(true);

    TestBed.inject(AppErrorHandler).handleError(error);

    await vi.waitFor(() =>
      expect(sentryLoaderMocks.handleSentryError).toHaveBeenCalledWith(
        error,
        expect.any(Object),
      ),
    );
    expect(globalErrorHandler.handleError).not.toHaveBeenCalled();
  });

  it('falls back to the global handler when lazy Sentry handling fails', async () => {
    const error = new Error('boom');
    sentryLoaderMocks.isSentryEnabled.mockReturnValue(true);
    sentryLoaderMocks.handleSentryError.mockResolvedValue(false);

    TestBed.inject(AppErrorHandler).handleError(error);

    await vi.waitFor(() =>
      expect(globalErrorHandler.handleError).toHaveBeenCalledWith(error),
    );
  });
});
