import {ConvexError} from 'convex/values';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {isNonRetryableReadError, retryWithDelays} from './async-control';

describe('retryWithDelays', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the first attempt immediately without waiting for the first delay entry', async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue('ok');

    const resultPromise = retryWithDelays({
      delaysMs: [100] as const,
      run,
    });

    expect(run).toHaveBeenCalledOnce();
    await expect(resultPromise).resolves.toBe('ok');
  });

  it('waits for subsequent retry delays before re-running', async () => {
    vi.useFakeTimers();
    const run = vi
      .fn<(_: number) => Promise<string>>()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce('ok');

    const resultPromise = retryWithDelays({
      delaysMs: [0, 250] as const,
      run,
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenNthCalledWith(1, 0);

    await vi.advanceTimersByTimeAsync(249);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(2, 1);
  });
});

describe('isNonRetryableReadError', () => {
  it.each([
    new Error('Event not found'),
    new Error('Unauthorized'),
    new Error('Forbidden'),
    new Error('Value does not match validator'),
    new ConvexError('Community not found'),
  ])('treats deterministic read failures as non-retryable', (error) => {
    expect(isNonRetryableReadError(error)).toBe(true);
  });

  it('treats ArgumentValidationError by name as non-retryable', () => {
    const error = new Error('bad args');
    error.name = 'ArgumentValidationError';

    expect(isNonRetryableReadError(error)).toBe(true);
  });

  it.each([
    new Error('Function execution timed out'),
    new Error('Failed to fetch'),
    'Network request failed',
  ])('keeps transient failures retryable', (error) => {
    expect(isNonRetryableReadError(error)).toBe(false);
  });
});
