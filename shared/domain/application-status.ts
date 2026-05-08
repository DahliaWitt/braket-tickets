export const APPLICATION_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'revoked',
] as const;
export type ApplicationStatus = typeof APPLICATION_STATUSES[number];
