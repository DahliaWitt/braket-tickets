import {ConvexError} from 'convex/values';
import {normalizeRuntimeErrorMessage} from '@/core/utils/error-message.utils';
import {
  isPaymentErrorCode,
  type PaymentErrorCode,
} from '@shared/contracts/payment-error-codes';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = entry;
  }
  return out;
}

const PAYMENT_ERROR_MESSAGES = {
  SESSION_EXPIRED: 'Session expired, please try again',
  SESSION_RESUME_REQUIRED:
    'We found an existing guest checkout for this email. Check your email for a resume link.',
  SOLD_OUT: 'This event is sold out',
  ORDER_NOT_OPEN: 'This reservation is no longer open',
  RESERVATION_EXPIRED: 'This reservation has expired. Please try again.',
  EVENT_UNAVAILABLE: 'This event is no longer available for checkout',
  LISTING_UNAVAILABLE: 'This resale listing is no longer available',
  INVALID_STATE: 'This checkout could not be completed',
  PRICE_MISMATCH: 'Price has changed, please refresh',
  RATE_LIMITED: 'Too many attempts, try again later',
  ORGANIZER_STRIPE_NOT_CONNECTED:
    'Tickets are unavailable — the organizer has not connected their payment account. Please contact the organizer.',
  ORGANIZER_STRIPE_CHARGES_DISABLED:
    'Tickets are unavailable — the organizer\u2019s payment account is not fully enabled. Please contact the organizer.',
  ORGANIZER_STRIPE_ONBOARDING_INCOMPLETE:
    'Tickets are unavailable — the organizer\u2019s payment account onboarding is incomplete. Please contact the organizer.',
  ORDER_CONNECTED_ACCOUNT_MISMATCH:
    'Checkout configuration changed. Please close the checkout and try again.',
  TERMS_NOT_ACCEPTED: 'Please accept the terms of service to continue',
} satisfies Record<PaymentErrorCode, string>;

const GENERIC_PAYMENT_FALLBACK =
  'Payment processing failed. Please try again or contact support if the problem persists.';

export function extractPaymentErrorMessage(
  err: unknown,
  fallback: string = GENERIC_PAYMENT_FALLBACK,
): string {
  let message = '';

  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (typeof data === 'string') {
      message = data;
    } else {
      const obj = asRecord(data);
      if (obj) {
        // The @convex-dev/rate-limiter component throws ConvexError with
        // {kind: 'RateLimited', name, retryAfter} and no `code` field, so it
        // would otherwise fall through every branch below to the generic
        // fallback. Surface the wait time when we have it.
        if (obj['kind'] === 'RateLimited') {
          const retryAfter = obj['retryAfter'];
          if (typeof retryAfter === 'number' && retryAfter > 0) {
            const minutes = Math.max(1, Math.ceil(retryAfter / 60_000));
            return `Too many attempts, try again in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
          }
          return PAYMENT_ERROR_MESSAGES.RATE_LIMITED;
        }

        const code = typeof obj['code'] === 'string' ? obj['code'] : null;
        const rawMessage =
          typeof obj['message'] === 'string' ? obj['message'] : '';

        // Prefer the buyer-facing copy for known payment codes. The backend
        // always sends both `code` and `message` (see appErrorData in
        // backend/convex/lib/errors.ts), and the raw message can leak internal
        // diagnostics (e.g. PRICE_MISMATCH carries raw cent amounts), so a
        // known code must win over the message. Fall back to the message for
        // unknown/absent codes, and to the code itself only as a last resort.
        if (code !== null && isPaymentErrorCode(code)) {
          message = PAYMENT_ERROR_MESSAGES[code];
        } else if (rawMessage !== '') {
          message = rawMessage;
        } else if (code !== null) {
          message = code;
        }
      }
    }
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }

  message = normalizeRuntimeErrorMessage(message);

  if (
    !message ||
    message === 'CONVEX_ERROR' ||
    message === 'Error' ||
    message === 'Server Error'
  ) {
    return fallback;
  }

  return message;
}
