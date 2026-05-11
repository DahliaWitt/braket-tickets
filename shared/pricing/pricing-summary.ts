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
        ? `${formatUsdCents(min)} all-in`
        : `${formatUsdCents(min)}-${formatUsdCents(max)} all-in sliding scale`;
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
          ? `${formatUsdCents(min)} all-in ticket price`
          : `${formatUsdCents(min)} to ${formatUsdCents(max)} all-in sliding scale ticket price`,
      unitAmountCents: regularPrice,
      totalAmountCents: regularPrice * quantity,
    };
  }

  const totalAmountCents = regularPrice * quantity;
  return {
    kind: 'regular',
    primaryText: `${formatUsdCents(regularPrice)} all-in`,
    secondaryText: supporterPrice
      ? `Supporter from ${formatUsdCents(supporterPrice)}`
      : undefined,
    ariaLabel: `${formatUsdCents(regularPrice)} all-in regular ticket price`,
    unitAmountCents: regularPrice,
    totalAmountCents,
  };
}
