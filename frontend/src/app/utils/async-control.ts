async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function isNonRetryableReadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalizedMessage = message.toLowerCase();
  return (
    (error instanceof Error && error.name === 'ArgumentValidationError') ||
    normalizedMessage.includes('not found') ||
    normalizedMessage.includes('unauthorized') ||
    normalizedMessage.includes('forbidden') ||
    normalizedMessage.includes('value does not match validator')
  );
}

export async function retryWithDelays<T>(options: {
  delaysMs: readonly number[];
  run: (attemptIndex: number) => Promise<T>;
  shouldRetry?: (error: unknown, attemptIndex: number) => boolean;
}): Promise<T> {
  const {delaysMs, run, shouldRetry = () => true} = options;
  if (delaysMs.length === 0) {
    throw new Error('retryWithDelays requires at least one attempt');
  }

  const runAttempt = async (attemptIndex: number): Promise<T> => {
    if (attemptIndex > 0) {
      const delayMs = delaysMs[attemptIndex] ?? 0;
      if (delayMs > 0) {
        await sleep(delayMs);
      }
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
