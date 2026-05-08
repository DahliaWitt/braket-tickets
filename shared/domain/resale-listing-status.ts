export const RESALE_LISTING_STATUSES = [
  'listed',
  'pending',
  'completed',
  'cancelled',
] as const;
export type ResaleListingStatus = typeof RESALE_LISTING_STATUSES[number];
