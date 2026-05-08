const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_INTERVAL_MS = 50;

interface HarnessWaitOptions {
  description?: string;
  intervalMs?: number;
  timeoutMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Zoneless harness locators do not retry on their own, so waits that depend on
 * render completion need an explicit polling primitive.
 */
export async function waitForHarnessCondition(
  condition: () => Promise<boolean>,
  options: HarnessWaitOptions = {},
): Promise<void> {
  const {
    description = 'condition',
    intervalMs = DEFAULT_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }

    await delay(intervalMs);
  }

  throw new Error(`Timed out waiting for ${description} after ${timeoutMs}ms`);
}
