export interface StorageUrlContext {
  storage: {
    getUrl: (id: string) => Promise<string | null>;
  };
}

export async function batchGetStorageUrls(
  ctx: StorageUrlContext,
  storageIds: ReadonlyArray<string | undefined | null>,
): Promise<Map<string, string | null>> {
  const uniqueIds = [
    ...new Set(storageIds.filter((id): id is string => typeof id === 'string')),
  ];

  const urlMap = new Map<string, string | null>();

  // Resolve each id: plain URLs pass through; storage IDs are resolved via Convex storage.
  const resolvedUrls = await Promise.all(
    uniqueIds.map((id) =>
      id.startsWith('http://') || id.startsWith('https://')
        ? id
        : ctx.storage.getUrl(id),
    ),
  );

  for (let i = 0; i < uniqueIds.length; i += 1) {
    urlMap.set(uniqueIds[i], resolvedUrls[i]);
  }

  return urlMap;
}
