import type {Value} from 'convex/values';
import type {PaymentErrorCode} from '@shared/contracts/payment-error-codes';
import {throwAppError} from './errors';

export function throwPaymentAppError(
  code: PaymentErrorCode,
  message: string,
  details?: Record<string, Value | undefined>,
): never {
  throwAppError(code, message, details);
}
