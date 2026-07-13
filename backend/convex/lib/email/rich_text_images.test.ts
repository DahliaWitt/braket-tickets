import {describe, expect, it} from 'vitest';
import {convexTest} from '../../setup.testing';
import {api} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';
import {
  areAllImagesConfirmed,
  buildImageUrlMap,
  collectImageStorageIds,
  recordPublishedEmailImages,
} from './rich_text_images';
import type {RichBodyDoc} from './rich_text_validator';

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

async function seedConfirmedUpload(): Promise<{
  t: ReturnType<typeof convexTest>;
  storageId: Id<'_storage'>;
  userId: Id<'users'>;
}> {
  const t = convexTest();
  const userId = await t.mutation(api.testing.users.createUserDirectly, {
    email: 'uploader@example.com',
    name: 'Uploader',
  });
  const asUser = t.withIdentity({subject: userId});
  const storageId = await t.run(async (ctx) => {
    const blob = new Blob([PNG_BYTES.buffer as ArrayBuffer], {
      type: 'image/png',
    });
    return await ctx.storage.store(blob);
  });
  const result = await asUser.action(api.storage.files.confirmUpload, {
    storageId,
    mimeType: 'image/png',
  });
  expect(result.valid).toBe(true);
  return {t, storageId, userId};
}

describe('collectImageStorageIds', () => {
  it('collects storage ids from nested image nodes in document order', () => {
    const doc: RichBodyDoc = {
      type: 'doc',
      content: [
        {type: 'image', attrs: {storageId: 'a', alt: ''}},
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{type: 'image', attrs: {storageId: 'b', alt: ''}}],
            },
          ],
        },
        {type: 'paragraph', content: [{type: 'text', text: 'x'}]},
      ],
    };
    expect(collectImageStorageIds(doc)).toEqual(['a', 'b']);
  });

  it('returns an empty array for a document with no images', () => {
    const doc: RichBodyDoc = {
      type: 'doc',
      content: [{type: 'paragraph', content: [{type: 'text', text: 'x'}]}],
    };
    expect(collectImageStorageIds(doc)).toEqual([]);
  });
});

describe('buildImageUrlMap', () => {
  it('maps each storage id to a durable /api/images/<id> url on the base', () => {
    const map = buildImageUrlMap(['sid1', 'sid2'], 'https://acme.convex.site');
    expect(map.get('sid1')).toBe('https://acme.convex.site/api/images/sid1');
    expect(map.get('sid2')).toBe('https://acme.convex.site/api/images/sid2');
  });

  it('url-encodes the storage id', () => {
    const map = buildImageUrlMap(['a/b'], 'https://acme.convex.site');
    expect(map.get('a/b')).toBe('https://acme.convex.site/api/images/a%2Fb');
  });
});

describe('areAllImagesConfirmed', () => {
  it('returns true when every id is a confirmed upload owned by the sender', async () => {
    const {t, storageId, userId} = await seedConfirmedUpload();
    const confirmed = await t.run((ctx) =>
      areAllImagesConfirmed(ctx, userId, [storageId]),
    );
    expect(confirmed).toBe(true);
  });

  it('returns false when any id is not confirmed', async () => {
    const {t, storageId, userId} = await seedConfirmedUpload();
    // Store a second file but never confirm it.
    const unconfirmed = await t.run(async (ctx) => {
      const blob = new Blob([PNG_BYTES.buffer as ArrayBuffer], {
        type: 'image/png',
      });
      return await ctx.storage.store(blob);
    });
    const result = await t.run((ctx) =>
      areAllImagesConfirmed(ctx, userId, [storageId, unconfirmed]),
    );
    expect(result).toBe(false);
  });

  it('returns false when the id is confirmed by a DIFFERENT user (ownership)', async () => {
    const {t, storageId, userId} = await seedConfirmedUpload();
    const otherUserId = await t.mutation(api.testing.users.createUserDirectly, {
      email: 'other@example.com',
      name: 'Other',
    });
    // The real owner passes...
    expect(
      await t.run((ctx) => areAllImagesConfirmed(ctx, userId, [storageId])),
    ).toBe(true);
    // ...but a different user cannot reuse the confirmed upload.
    expect(
      await t.run((ctx) =>
        areAllImagesConfirmed(ctx, otherUserId, [storageId]),
      ),
    ).toBe(false);
  });

  it('returns false (fail closed) for a malformed id string', async () => {
    const {t, userId} = await seedConfirmedUpload();
    const result = await t.run((ctx) =>
      areAllImagesConfirmed(ctx, userId, ['not-a-real-storage-id']),
    );
    expect(result).toBe(false);
  });

  it('returns true for an empty id list', async () => {
    const {t, userId} = await seedConfirmedUpload();
    const result = await t.run((ctx) => areAllImagesConfirmed(ctx, userId, []));
    expect(result).toBe(true);
  });
});

describe('recordPublishedEmailImages', () => {
  it('registers each unique id once and is idempotent across sends', async () => {
    const {t, storageId} = await seedConfirmedUpload();
    // Duplicate ids within one call + a repeat call (second send of the same
    // image) must yield exactly one registry row with its original timestamp.
    await t.run((ctx) =>
      recordPublishedEmailImages(ctx, [storageId, storageId]),
    );
    const first = await t.run((ctx) =>
      ctx.db
        .query('richEmailImages')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .collect(),
    );
    expect(first).toHaveLength(1);

    await t.run((ctx) => recordPublishedEmailImages(ctx, [storageId]));
    const second = await t.run((ctx) =>
      ctx.db
        .query('richEmailImages')
        .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
        .collect(),
    );
    expect(second).toHaveLength(1);
    expect(second[0].firstPublishedAt).toBe(first[0].firstPublishedAt);
  });
});
