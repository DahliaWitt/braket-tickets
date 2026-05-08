import { describe, it, expect, beforeEach } from 'vitest';
import { createSubmitGuard, createClickLock, type SubmitGuard } from './submit-guard';

describe('submit-guard', () => {
  describe('createSubmitGuard', () => {
    let guard: SubmitGuard;

    beforeEach(() => {
      guard = createSubmitGuard();
    });

    it('should initialize with isSubmitting as false', () => {
      expect(guard.isSubmitting()).toBe(false);
    });

    it('should set isSubmitting to true during execution', async () => {
      let capturedState: boolean | undefined;

      await guard.guard(async () => {
        capturedState = guard.isSubmitting();
        return 'result';
      });

      expect(capturedState).toBe(true);
      expect(guard.isSubmitting()).toBe(false);
    });

    it('should return the result of the guarded function', async () => {
      const result = await guard.guard(async () => {
        return { success: true, data: 42 };
      });

      expect(result).toEqual({ success: true, data: 42 });
    });

    it('should reset isSubmitting to false after error', async () => {
      await expect(
        guard.guard(async () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');

      expect(guard.isSubmitting()).toBe(false);
    });

    describe('coalescing behavior (default)', () => {
      it('should coalesce concurrent calls to return the same result', async () => {
        let resolveFirst: ((value: string) => void) | undefined;
        const firstPromise = new Promise<string>((resolve) => {
          resolveFirst = resolve;
        });

        // Start first submission
        const result1Promise = guard.guard(async () => {
          return firstPromise;
        });

        // Start second submission while first is in progress
        const result2Promise = guard.guard(async () => {
          return 'second result';
        });

        // Both should be waiting
        expect(guard.isSubmitting()).toBe(true);

        // Resolve the first
        resolveFirst!('first result');

        const [result1, result2] = await Promise.all([result1Promise, result2Promise]);

        // Both should get the first result (coalesced)
        expect(result1).toBe('first result');
        expect(result2).toBe('first result');
      });

      it('should allow new submission after previous completes', async () => {
        const result1 = await guard.guard(async () => 'first');
        const result2 = await guard.guard(async () => 'second');

        expect(result1).toBe('first');
        expect(result2).toBe('second');
      });
    });

    describe('non-coalescing behavior', () => {
      let nonCoalescingGuard: SubmitGuard;

      beforeEach(() => {
        nonCoalescingGuard = createSubmitGuard({ coalesce: false });
      });

      it('should return undefined for concurrent calls when coalesce is false', async () => {
        let resolveFirst: ((value: string) => void) | undefined;
        const firstPromise = new Promise<string>((resolve) => {
          resolveFirst = resolve;
        });

        // Start first submission
        const result1Promise = nonCoalescingGuard.guard(async () => {
          return firstPromise;
        });

        // Start second submission while first is in progress
        const result2Promise = nonCoalescingGuard.guard(async () => {
          return 'second result';
        });

        // Second call should return undefined immediately
        const result2 = await result2Promise;
        expect(result2).toBeUndefined();

        // First should complete normally
        resolveFirst!('first result');
        const result1 = await result1Promise;
        expect(result1).toBe('first result');
      });
    });

    describe('reset', () => {
      it('should reset the guard state', async () => {
        // Create a promise that won't resolve (discard resolve/reject)
        const neverResolves = new Promise<string>((_resolve, _reject) => {
          // Intentionally never resolves
        });

        // Start a submission that will hang (discard promise)
        void guard.guard(async () => neverResolves);

        expect(guard.isSubmitting()).toBe(true);

        // Reset the guard
        guard.reset();

        expect(guard.isSubmitting()).toBe(false);

        // Should be able to start a new submission
        const newResult = await guard.guard(async () => 'new result');
        expect(newResult).toBe('new result');
      });
    });
  });

  describe('createClickLock', () => {
    it('should execute the function and return its result', async () => {
      const lock = createClickLock();

      const result = await lock(async () => {
        return 'click result';
      });

      expect(result).toBe('click result');
    });

    it('should return undefined for concurrent calls', async () => {
      const lock = createClickLock();
      let resolveFirst: ((value: string) => void) | undefined;

      const firstPromise = new Promise<string>((resolve) => {
        resolveFirst = resolve;
      });

      // Start first click
      const result1Promise = lock(async () => firstPromise);

      // Start second click while first is locked
      const result2Promise = lock(async () => 'second click');

      // Second should return undefined immediately
      const result2 = await result2Promise;
      expect(result2).toBeUndefined();

      // First should complete normally
      resolveFirst!('first click');
      const result1 = await result1Promise;
      expect(result1).toBe('first click');
    });

    it('should unlock after function completes', async () => {
      const lock = createClickLock();

      await lock(async () => 'first');
      const result = await lock(async () => 'second');

      expect(result).toBe('second');
    });

    it('should unlock after function throws', async () => {
      const lock = createClickLock();

      await expect(
        lock(async () => {
          throw new Error('click error');
        }),
      ).rejects.toThrow('click error');

      // Should be unlocked now
      const result = await lock(async () => 'recovery');
      expect(result).toBe('recovery');
    });

    it('should handle multiple sequential calls', async () => {
      const lock = createClickLock();
      const results: string[] = [];

      for (let i = 0; i < 5; i++) {
        const result = await lock(async () => `call-${i}`);
        if (result) results.push(result);
      }

      expect(results).toEqual(['call-0', 'call-1', 'call-2', 'call-3', 'call-4']);
    });
  });
});
