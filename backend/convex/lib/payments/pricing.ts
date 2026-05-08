import type {TicketTier} from '../../lib/validators/ticketing';
import {throwAppError, throwInvalidInput} from '../../lib/errors';
import type {PaymentErrorCode} from '@shared/contracts/payment-error-codes';

interface PricingEventConfig {
  price: number;
  slidingScaleEnabled?: boolean;
  slidingScaleMin?: number;
  slidingScaleMax?: number;
  supporterDefaultPrice?: number;
}

function throwPricingError(
  message: string,
  errorCode?: PaymentErrorCode,
): never {
  if (errorCode) {
    throwAppError(errorCode, message);
  }
  throwInvalidInput(message);
}

export function validateTierPricing(
  event: PricingEventConfig,
  args: {
    tier: TicketTier;
    totalAmount: number;
    quantity?: number;
    errorCode?: PaymentErrorCode;
  },
): void {
  const quantity = args.quantity ?? 1;
  const unitPrice = args.totalAmount / quantity;

  if (args.tier === 'regular') {
    const expectedAmount = event.price * quantity;
    if (args.totalAmount !== expectedAmount) {
      throwPricingError(
        `Invalid amount for regular tier. Expected ${expectedAmount}, got ${args.totalAmount}`,
        args.errorCode,
      );
    }
    return;
  }

  if (args.tier === 'notaflof') {
    if (!event.slidingScaleEnabled) {
      throwPricingError(
        'Sliding scale not enabled for this event',
        args.errorCode,
      );
    }

    const min = event.slidingScaleMin ?? 0;
    if (unitPrice < min) {
      throwPricingError(
        `Amount below sliding scale minimum (${min})`,
        args.errorCode,
      );
    }

    if (
      event.slidingScaleMax !== undefined &&
      unitPrice > event.slidingScaleMax
    ) {
      throwPricingError(
        `Amount above sliding scale maximum (${event.slidingScaleMax})`,
        args.errorCode,
      );
    }
    return;
  }

  // Supporter must be strictly greater than regular price
  const regularPrice = event.price ?? 0;
  const supporterFloor = regularPrice + 1;
  const min = Math.max(event.supporterDefaultPrice ?? 0, supporterFloor);
  if (unitPrice < min) {
    throwPricingError(
      `Amount below supporter minimum (${min})`,
      args.errorCode,
    );
  }
}
