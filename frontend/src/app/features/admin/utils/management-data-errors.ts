import { ConvexError } from 'convex/values';

// LINT.IfChange
/** Must match MANAGEMENT_DATA_TOO_LARGE_CODE in backend/convex/lib/management_limits.ts */
export const MANAGEMENT_DATA_TOO_LARGE_CODE = 'MANAGEMENT_DATA_TOO_LARGE';
// LINT.ThenChange(../../../../../../backend/convex/lib/management_limits.ts)

function getStructuredConvexErrorData(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ConvexError)) {
    return null;
  }

  const data: unknown = Reflect.get(error, 'data');
  if (typeof data !== 'object' || data === null) {
    return null;
  }

  return data as Record<string, unknown>;
}

export function isManagementDataTooLargeError(error: unknown): boolean {
  const data = getStructuredConvexErrorData(error);
  if (!data) {
    return false;
  }

  return data['code'] === MANAGEMENT_DATA_TOO_LARGE_CODE;
}

export function getManagementDataTooLargeMessage(error: unknown): string | null {
  const data = getStructuredConvexErrorData(error);
  if (!data || data['code'] !== MANAGEMENT_DATA_TOO_LARGE_CODE) {
    return null;
  }

  return typeof data['message'] === 'string' ? data['message'] : null;
}
