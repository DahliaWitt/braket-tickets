import type { Id, TableNames } from '@convex/_generated/dataModel';

const CONVEX_ID_PATTERN = /^[a-z0-9]{32}$/;

export function isConvexId<T extends TableNames>(
  value: string | null | undefined,
): value is Id<T> {
  return typeof value === 'string' && CONVEX_ID_PATTERN.test(value);
}
