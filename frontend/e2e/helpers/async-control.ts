export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function retryWithDelays<T>(options: {
  delaysMs: readonly number[];
  run: (attemptIndex: number) => Promise<T>;
  shouldRetry?: (error: unknown, attemptIndex: number) => boolean;
}): Promise<T> {
  const { delaysMs, run, shouldRetry = () => true } = options;
  if (delaysMs.length === 0) {
    throw new Error('retryWithDelays requires at least one attempt');
  }

  const runAttempt = async (attemptIndex: number): Promise<T> => {
    const delayMs = delaysMs[attemptIndex] ?? 0;
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      return await run(attemptIndex);
    } catch (error) {
      const isFinalAttempt = attemptIndex >= delaysMs.length - 1;
      if (isFinalAttempt || !shouldRetry(error, attemptIndex)) {
        throw error;
      }
      return runAttempt(attemptIndex + 1);
    }
  };

  return runAttempt(0);
}

export async function pollUntil<T>(options: {
  timeoutMs: number;
  intervalMs: number;
  getValue: () => Promise<T | null>;
}): Promise<T | null> {
  const { timeoutMs, intervalMs, getValue } = options;
  const deadline = Date.now() + timeoutMs;

  const poll = async (): Promise<T | null> => {
    const value = await getValue();
    if (value !== null) return value;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
    return poll();
  };

  return poll();
}
