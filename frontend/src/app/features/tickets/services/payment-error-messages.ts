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

function mapPaymentErrorCode(code: string): string {
  return isPaymentErrorCode(code) ? PAYMENT_ERROR_MESSAGES[code] : code;
}

export function extractPaymentErrorMessage(err: unknown): string {
  let message = '';

  if (err instanceof ConvexError) {
    const data: unknown = err.data;
    if (typeof data === 'string') {
      message = data;
    } else {
      const obj = asRecord(data);
      if (obj) {
        if (typeof obj['message'] === 'string') {
          message = obj['message'];
        } else if (typeof obj['code'] === 'string') {
          message = mapPaymentErrorCode(obj['code']);
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
    return 'Payment processing failed. Please try again or contact support if the problem persists.';
  }

  return message;
}
