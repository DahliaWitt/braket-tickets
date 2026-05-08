export const STRIPE_WEBHOOK_IN_FLIGHT_CODE = 'STRIPE_WEBHOOK_IN_FLIGHT';

function getStructuredErrorData(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return null;
  }
  return (error as {data?: unknown}).data;
}

function getStructuredErrorCode(error: unknown): string | null {
  const data = getStructuredErrorData(error);
  if (
    typeof data === 'object' &&
    data !== null &&
    'code' in data &&
    typeof (data as {code?: unknown}).code === 'string'
  ) {
    return (data as {code: string}).code;
  }
  return null;
}

export function isStripeWebhookInFlightError(error: unknown): boolean {
  if (getStructuredErrorCode(error) === STRIPE_WEBHOOK_IN_FLIGHT_CODE) {
    return true;
  }

  return (
    error instanceof Error &&
    error.message.includes(STRIPE_WEBHOOK_IN_FLIGHT_CODE)
  );
}
