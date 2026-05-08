import { signal, type Signal } from '@angular/core';

/**
 * A guard to prevent double-submission of forms and async operations.
 * 
 * The guard ensures that only one submission can be in progress at a time.
 * If a second submission is attempted while one is in progress, it will
 * return the result of the first submission (coalescing behavior).
 * 
 * This solves the TOCTOU (time-of-check-time-of-use) race condition where:
 * 1. User clicks submit
 * 2. `if (isSubmitting) return` check passes (false)
 * 3. User clicks again before `isSubmitting = true` executes
 * 4. Second click also passes the check
 * 5. Two submissions are made
 * 
 * @example
 * ```typescript
 * class MyComponent {
 *   private submitGuard = createSubmitGuard();
 *   isSubmitting = this.submitGuard.isSubmitting;
 * 
 *   async onSubmit() {
 *     const result = await this.submitGuard.guard(async () => {
 *       return await this.api.submit(this.data);
 *     });
 *     // result is undefined if guard rejected, otherwise the return value
 *   }
 * }
 * ```
 */
export interface SubmitGuard {
  /** Read-only signal indicating if a submission is in progress */
  isSubmitting: Signal<boolean>;
  
  /**
   * Guards an async operation from concurrent execution.
   * 
   * @param fn - The async function to execute
   * @returns The result of the function, or undefined if already submitting
   *          and coalescing is disabled. With coalescing (default), returns
   *          the result of the in-flight submission.
   */
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  
  /**
   * Resets the guard state. Useful for error recovery or testing.
   */
  reset: () => void;
}

/**
 * Creates a submit guard instance.
 * 
 * @param options.coalesce - If true (default), concurrent calls return the
 *                           result of the in-flight submission. If false,
 *                           concurrent calls return undefined immediately.
 * @returns A SubmitGuard instance
 */
export function createSubmitGuard(options?: { coalesce?: boolean }): SubmitGuard {
  const coalesce = options?.coalesce ?? true;
  const isSubmitting = signal(false);
  let submitPromise: Promise<unknown> | null = null;
  
  return {
    isSubmitting: isSubmitting.asReadonly(),
    
    guard: async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      // If already submitting, handle according to coalesce setting
      if (submitPromise) {
        if (coalesce) {
          // Return the existing promise's result
          return submitPromise as Promise<T>;
        } else {
          // Reject concurrent submissions
          return undefined;
        }
      }
      
      isSubmitting.set(true);
      
      try {
        submitPromise = fn();
        const result = await submitPromise;
        return result as T;
      } finally {
        submitPromise = null;
        isSubmitting.set(false);
      }
    },
    
    reset: () => {
      submitPromise = null;
      isSubmitting.set(false);
    }
  };
}

/**
 * A simpler version that just prevents double-clicks without coalescing.
 * Uses a mutex pattern where concurrent calls are silently dropped.
 * 
 * @example
 * ```typescript
 * class MyComponent {
 *   private clickLock = createClickLock();
 * 
 *   async onClick() {
 *     await this.clickLock(async () => {
 *       // Only one execution at a time
 *     });
 *   }
 * }
 * ```
 */
export function createClickLock(): <T>(fn: () => Promise<T>) => Promise<T | undefined> {
  let locked = false;
  
  return async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (locked) return undefined;
    
    locked = true;
    try {
      return await fn();
    } finally {
      locked = false;
    }
  };
}
