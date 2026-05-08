export async function collectMatchingInQuery<T>(
  query: AsyncIterable<T>,
  predicate: (item: T) => boolean,
  limit?: number,
): Promise<T[]> {
  const matches: T[] = [];
  for await (const item of query) {
    if (!predicate(item)) continue;
    matches.push(item);
    if (limit !== undefined && matches.length >= limit) {
      break;
    }
  }
  return matches;
}

export async function takeFromQuery<T>(
  query: AsyncIterable<T>,
  limit: number,
): Promise<T[]> {
  if (limit <= 0) {
    return [];
  }

  const items: T[] = [];
  for await (const item of query) {
    items.push(item);
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}

export async function collectAllQueryUnsafe<T>(
  query: AsyncIterable<T>,
): Promise<T[]> {
  const items: T[] = [];
  for await (const item of query) {
    items.push(item);
  }
  return items;
}

export async function countMatchingInQuery<T>(
  query: AsyncIterable<T>,
  predicate: (item: T) => boolean = () => true,
  stopAfter?: number,
): Promise<number> {
  let count = 0;
  for await (const item of query) {
    if (!predicate(item)) continue;
    count += 1;
    if (stopAfter !== undefined && count >= stopAfter) {
      break;
    }
  }
  return count;
}

export async function findMatchingInQuery<T>(
  query: AsyncIterable<T>,
  predicate: (item: T) => boolean,
  limit?: number,
): Promise<T | null> {
  let scanned = 0;
  for await (const item of query) {
    if (limit !== undefined && scanned >= limit) {
      break;
    }
    scanned += 1;
    if (predicate(item)) {
      return item;
    }
  }
  return null;
}
