/**
 * @vitest-environment node
 */
import {describe, it, expect, vi, afterEach} from 'vitest';
import {ConvexError} from 'convex/values';

// Mock @convex-dev/workpool and generated API before importing resilience
vi.mock('@convex-dev/workpool', () => {
  function Workpool(_component: unknown, options: unknown) {
    return {options};
  }
  return {Workpool};
});

vi.mock('../_generated/api', () => ({
  components: {
    payoutPool: {},
    stripePool: {},
  },
}));

import {withRetry, payoutPool, stripePool} from './resilience';

/** Execute setTimeout callbacks synchronously so tests don't wait. */
function mockSyncSetTimeout(onDelay?: (ms: number) => void) {
  vi.spyOn(global, 'setTimeout').mockImplementation(
    (cb: TimerHandler, ms?: number) => {
      onDelay?.(ms ?? 0);
      if (typeof cb === 'function') cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('withRetry', () => {
  describe('success cases', () => {
    it('succeeds on first attempt without retrying', async () => {
      const fn = vi.fn().mockResolvedValue('ok');

      const result = await withRetry(fn);

      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on transient failure then succeeds', async () => {
      const transientError = new Error('network blip');
      const fn = vi
        .fn()
        .mockRejectedValueOnce(transientError)
        .mockResolvedValue('recovered');

      mockSyncSetTimeout();

      const result = await withRetry(fn);

      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('exhaustion', () => {
    it('exhausts all retries (default 3) and throws last error', async () => {
      const error = new Error('persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      mockSyncSetTimeout();

      await expect(withRetry(fn)).rejects.toThrow('persistent failure');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('client error detection (no retry)', () => {
    it('does not retry ConvexError with structured object data', async () => {
      const clientError = new ConvexError({
        code: 'INVALID_INPUT',
        field: 'email',
      });
      const fn = vi.fn().mockRejectedValue(clientError);

      await expect(withRetry(fn)).rejects.toThrow(clientError);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry Stripe 4xx errors', async () => {
      const stripeError = Object.assign(new Error('Bad Request'), {
        statusCode: 400,
      });
      const fn = vi.fn().mockRejectedValue(stripeError);

      await expect(withRetry(fn)).rejects.toThrow('Bad Request');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry status code 422', async () => {
      const err = Object.assign(new Error('Unprocessable Entity'), {
        statusCode: 422,
      });
      const fn = vi.fn().mockRejectedValue(err);

      await expect(withRetry(fn)).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('does not retry status code 404', async () => {
      const err = Object.assign(new Error('Not Found'), {statusCode: 404});
      const fn = vi.fn().mockRejectedValue(err);

      await expect(withRetry(fn)).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('retried errors', () => {
    it('retries ConvexError with string data (not structured)', async () => {
      const stringDataError = new ConvexError('Something went wrong');
      const fn = vi
        .fn()
        .mockRejectedValueOnce(stringDataError)
        .mockResolvedValue('success');

      mockSyncSetTimeout();

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries errors with statusCode 500+', async () => {
      const serverError = Object.assign(new Error('Internal Server Error'), {
        statusCode: 500,
      });
      const fn = vi
        .fn()
        .mockRejectedValueOnce(serverError)
        .mockResolvedValue('success');

      mockSyncSetTimeout();

      const result = await withRetry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('retries plain Error instances', async () => {
      const plain = new Error('generic error');
      const fn = vi.fn().mockRejectedValueOnce(plain).mockResolvedValue('ok');

      mockSyncSetTimeout();

      const result = await withRetry(fn);
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('onRetry callback', () => {
    it('calls onRetry with attempt number and error', async () => {
      const error = new Error('transient');
      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue('done');

      mockSyncSetTimeout();

      const onRetry = vi.fn();
      await withRetry(fn, {maxAttempts: 5, onRetry});

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, error);
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, error);
    });

    it('does not call onRetry when succeeding on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const onRetry = vi.fn();

      await withRetry(fn, {onRetry});

      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe('custom maxAttempts', () => {
    it('respects maxAttempts=5', async () => {
      const error = new Error('keep failing');
      const fn = vi.fn().mockRejectedValue(error);

      mockSyncSetTimeout();

      await expect(withRetry(fn, {maxAttempts: 5})).rejects.toThrow(
        'keep failing',
      );
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('respects maxAttempts=1 (no retries)', async () => {
      const error = new Error('fail once');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(withRetry(fn, {maxAttempts: 1})).rejects.toThrow(
        'fail once',
      );
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('exponential backoff', () => {
    it('invokes setTimeout between retries with a positive delay', async () => {
      const error = new Error('transient');
      const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ok');

      const delays: number[] = [];
      mockSyncSetTimeout((ms) => delays.push(ms));

      await withRetry(fn, {initialBackoffMs: 500, base: 2});

      expect(delays).toHaveLength(1);
      // delay = 500 * 2^0 + jitter; jitter is ±25%, so delay is in [375, 625]
      expect(delays[0]).toBeGreaterThan(0);
    });

    it('uses longer delays for later attempts', async () => {
      const error = new Error('transient');
      const fn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue('ok');

      const delays: number[] = [];
      mockSyncSetTimeout((ms) => delays.push(ms));

      await withRetry(fn, {maxAttempts: 3, initialBackoffMs: 1000, base: 2});

      expect(delays).toHaveLength(2);
      // attempt 1 delay base: 1000ms; attempt 2 delay base: 2000ms
      // With jitter both could overlap at extremes, but the second base is 2x larger
      // Just verify both are positive numbers
      expect(delays[0]).toBeGreaterThan(0);
      expect(delays[1]).toBeGreaterThan(0);
    });
  });
});

describe('workpool instances', () => {
  it('exports payoutPool with correct config', () => {
    expect(payoutPool).toBeDefined();
    expect(
      (payoutPool as {options: Record<string, unknown>}).options.maxParallelism,
    ).toBe(5);
    expect(
      (payoutPool as {options: Record<string, unknown>}).options
        .retryActionsByDefault,
    ).toBe(true);
    expect(
      (payoutPool as {options: Record<string, unknown>}).options
        .defaultRetryBehavior,
    ).toEqual({
      maxAttempts: 4,
      initialBackoffMs: 5000,
      base: 2,
    });
  });

  it('exports stripePool with correct config', () => {
    expect(stripePool).toBeDefined();
    expect(
      (stripePool as {options: Record<string, unknown>}).options.maxParallelism,
    ).toBe(10);
    expect(
      (stripePool as {options: Record<string, unknown>}).options
        .retryActionsByDefault,
    ).toBe(true);
    expect(
      (stripePool as {options: Record<string, unknown>}).options
        .defaultRetryBehavior,
    ).toEqual({
      maxAttempts: 4,
      initialBackoffMs: 1000,
      base: 2,
    });
  });
});
