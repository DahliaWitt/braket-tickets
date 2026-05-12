import type {EventVisibility} from '../domain/event-visibility';

export interface BuyerPricingInput {
  price: number;
  visibility?: EventVisibility;
  slidingScaleEnabled?: boolean;
  slidingScaleMin?: number;
  slidingScaleMax?: number;
  supporterDefaultPrice?: number;
  isResale?: boolean;
  quantity?: number;
  canSeePrice?: boolean;
}

export type BuyerPricingKind =
  | 'regular'
  | 'sliding_scale'
  | 'resale'
  | 'sign_in_required';

export interface BuyerPricingSummary {
  kind: BuyerPricingKind;
  primaryText: string;
  secondaryText?: string;
  ariaLabel: string;
  unitAmountCents: number | null;
  totalAmountCents: number | null;
}

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatUsdCents(cents: number): string {
  return USD_FORMATTER.format(cents / 100);
}

/**
 * Builds buyer-facing ticket price copy from a {@link BuyerPricingInput}.
 *
 * Pricing mode precedence is intentional:
 * 1. `canSeePrice === false` hides prices and returns sign-in-required copy.
 * 2. `isResale === true` returns resale unit/total copy.
 * 3. `slidingScaleEnabled === true` returns sliding-scale range copy.
 * 4. Otherwise, regular pricing is returned.
 *
 * @param input Event or ticket pricing fields plus display-context flags.
 * @returns A {@link BuyerPricingSummary} with display text, accessible label,
 * and canonical unit/total cents where visible.
 */
export function getBuyerPricingSummary(
  input: BuyerPricingInput,
): BuyerPricingSummary {
  if (input.canSeePrice === false) {
    return {
      kind: 'sign_in_required',
      primaryText: 'Sign in for pricing',
      ariaLabel: 'Sign in for ticket pricing',
      unitAmountCents: null,
      totalAmountCents: null,
    };
  }

  const quantity = Math.max(1, input.quantity ?? 1);
  const regularPrice = Math.max(0, input.price);

  if (input.isResale === true) {
    const totalAmountCents = regularPrice * quantity;
    return {
      kind: 'resale',
      primaryText:
        quantity > 1
          ? `${formatUsdCents(regularPrice)} each resale`
          : `${formatUsdCents(regularPrice)} resale`,
      secondaryText:
        quantity > 1 ? `${formatUsdCents(totalAmountCents)} total` : undefined,
      ariaLabel:
        quantity > 1
          ? `${formatUsdCents(regularPrice)} each resale ticket, ${formatUsdCents(totalAmountCents)} total`
          : `${formatUsdCents(regularPrice)} resale ticket`,
      unitAmountCents: regularPrice,
      totalAmountCents,
    };
  }

  const supporterPrice =
    input.supporterDefaultPrice !== undefined &&
    input.supporterDefaultPrice > regularPrice
      ? input.supporterDefaultPrice
      : null;

  if (input.slidingScaleEnabled === true) {
    const min = Math.max(0, input.slidingScaleMin ?? 0);
    const max = Math.max(min, input.slidingScaleMax ?? regularPrice);
    const primaryText =
      min === max
        ? formatUsdCents(min)
        : `${formatUsdCents(min)}-${formatUsdCents(max)} sliding scale`;
    const secondaryParts = [
      `Regular ${formatUsdCents(regularPrice)}`,
      supporterPrice
        ? `supporter from ${formatUsdCents(supporterPrice)}`
        : null,
    ].filter((part): part is string => part !== null);

    return {
      kind: 'sliding_scale',
      primaryText,
      secondaryText:
        secondaryParts.length > 0 ? secondaryParts.join(' / ') : undefined,
      ariaLabel:
        min === max
          ? `${formatUsdCents(min)} ticket price`
          : `${formatUsdCents(min)} to ${formatUsdCents(max)} sliding scale ticket price`,
      unitAmountCents: regularPrice,
      totalAmountCents: regularPrice * quantity,
    };
  }

  const totalAmountCents = regularPrice * quantity;
  return {
    kind: 'regular',
    primaryText: formatUsdCents(regularPrice),
    secondaryText: supporterPrice
      ? `Supporter from ${formatUsdCents(supporterPrice)}`
      : undefined,
    ariaLabel: `${formatUsdCents(regularPrice)} regular ticket price`,
    unitAmountCents: regularPrice,
    totalAmountCents,
  };
}
