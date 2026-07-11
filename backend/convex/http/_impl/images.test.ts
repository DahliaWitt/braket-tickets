import {describe, expect, it, vi} from 'vitest';
import type {ActionCtx} from '../../_generated/server';
import {convexTest} from '../../setup.testing';
import {api, internal} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';
import {recordPublishedEmailImages} from '../../lib/email/rich_text_images';
import {cleanupReplacedUpload} from '../../lib/upload_validation';
import {handlePublicImageGet} from './images';

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const SITE = 'https://acme.convex.site';

function createCtx(overrides?: {
  runQuery?: ReturnType<typeof vi.fn>;
  storageGet?: ReturnType<typeof vi.fn>;
}): ActionCtx {
  return {
    runQuery: overrides?.runQuery ?? vi.fn(),
    storage: {get: overrides?.storageGet ?? vi.fn()},
  } as unknown as ActionCtx;
}

describe('handlePublicImageGet — route behavior', () => {
  it('streams a confirmed image with its content-type and an immutable cache', async () => {
    const blob = new Blob([PNG_BYTES.buffer as ArrayBuffer], {
      type: 'image/png',
    });
    const runQuery = vi
      .fn()
      .mockResolvedValue({storageId: 'sid1', contentType: 'image/png'});
    const storageGet = vi.fn().mockResolvedValue(blob);
    const ctx = createCtx({runQuery, storageGet});

    const res = await handlePublicImageGet(
      ctx,
      new Request(`${SITE}/api/images/sid1`),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(Array.from(body)).toEqual(Array.from(PNG_BYTES));
    // The query is asked for exactly the decoded path id.
    expect(runQuery).toHaveBeenCalledWith(
      internal.storage.files.getPublishedEmailImage,
      {storageId: 'sid1'},
    );
  });

  it('returns 404 (no-store) when the id is not a published email image', async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const ctx = createCtx({runQuery});

    const res = await handlePublicImageGet(
      ctx,
      new Request(`${SITE}/api/images/unconfirmed`),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 404 without querying when the id segment is empty', async () => {
    const runQuery = vi.fn();
    const ctx = createCtx({runQuery});

    const res = await handlePublicImageGet(
      ctx,
      new Request(`${SITE}/api/images/`),
    );

    expect(res.status).toBe(404);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('decodes a percent-encoded id before querying', async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const ctx = createCtx({runQuery});

    await handlePublicImageGet(ctx, new Request(`${SITE}/api/images/a%2Fb`));

    expect(runQuery).toHaveBeenCalledWith(
      internal.storage.files.getPublishedEmailImage,
      {storageId: 'a/b'},
    );
  });
});

describe('getPublishedEmailImage — DB gate', () => {
  async function seedConfirmed(blobType = 'image/png'): Promise<{
    t: ReturnType<typeof convexTest>;
    storageId: Id<'_storage'>;
  }> {
    const t = convexTest();
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      email: 'uploader@example.com',
      name: 'Uploader',
    });
    const asUser = t.withIdentity({subject: userId});
    const storageId = await t.run(async (ctx) => {
      const blob = new Blob([PNG_BYTES.buffer as ArrayBuffer], {
        type: blobType,
      });
      return await ctx.storage.store(blob);
    });
    const result = await asUser.action(api.storage.files.confirmUpload, {
      storageId,
      mimeType: 'image/png',
    });
    expect(result.valid).toBe(true);
    return {t, storageId};
  }

  /** Marks the image as published in a sent email (the send-handler step). */
  async function publish(
    t: ReturnType<typeof convexTest>,
    storageId: Id<'_storage'>,
  ): Promise<void> {
    await t.run((ctx) => recordPublishedEmailImages(ctx, [storageId]));
  }

  it('resolves a confirmed AND email-published upload', async () => {
    const {t, storageId} = await seedConfirmed();
    await publish(t, storageId);
    const resolved = await t.query(
      internal.storage.files.getPublishedEmailImage,
      {storageId},
    );
    expect(resolved?.storageId).toBe(storageId);
    expect(typeof resolved?.contentType).toBe('string');
  });

  it('returns null for a confirmed upload never published in an email (poster scenario)', async () => {
    // Regression: the public route must NOT expose generic confirmed uploads
    // (event posters, community logos, abandoned composer drafts). Only images
    // registered by an actual send are servable.
    const {t, storageId} = await seedConfirmed();
    const resolved = await t.query(
      internal.storage.files.getPublishedEmailImage,
      {storageId},
    );
    expect(resolved).toBeNull();
  });

  it('keeps serving after upload-lifecycle cleanup deletes the confirmedUploads row (durability)', async () => {
    // Regression for the send-then-replace lifecycle: an image published in a
    // sent email must keep resolving even if the entity that also referenced
    // the upload is later replaced and `cleanupReplacedUpload` runs. The
    // registry row (written post-gate at send time) is the durable authority;
    // a live confirmedUploads row must NOT be required.
    const {t, storageId} = await seedConfirmed();
    await publish(t, storageId);

    await t.run((ctx) => cleanupReplacedUpload(ctx, storageId));

    const resolved = await t.query(
      internal.storage.files.getPublishedEmailImage,
      {storageId},
    );
    expect(resolved?.storageId).toBe(storageId);
    // The blob itself was pinned — cleanup must not have deleted it. (Return a
    // boolean: a raw Blob is not a serializable convex-test return value.)
    const blobExists = await t.run(
      async (ctx) => (await ctx.storage.get(storageId)) !== null,
    );
    expect(blobExists).toBe(true);
  });

  it('returns null for a well-formed but unconfirmed, unpublished storage id', async () => {
    const t = convexTest();
    const unconfirmed = await t.run(async (ctx) => {
      const blob = new Blob([PNG_BYTES.buffer as ArrayBuffer], {
        type: 'image/png',
      });
      return await ctx.storage.store(blob);
    });
    const resolved = await t.query(
      internal.storage.files.getPublishedEmailImage,
      {storageId: unconfirmed},
    );
    expect(resolved).toBeNull();
  });

  it('returns null (fail closed) for a malformed id', async () => {
    const t = convexTest();
    const resolved = await t.query(
      internal.storage.files.getPublishedEmailImage,
      {storageId: 'not-a-real-storage-id'},
    );
    expect(resolved).toBeNull();
  });

  it('clamps a non-image stored content-type to octet-stream (polyglot defense)', async () => {
    // Real PNG bytes, but the blob is stored advertising text/html — a polyglot
    // upload. Magic-byte validation passes (the bytes ARE a real PNG), so it
    // becomes a confirmed upload; the served type must NOT be the client's
    // text/html or the route could serve executable HTML on the site domain.
    const {t, storageId} = await seedConfirmed('text/html');
    await publish(t, storageId);
    const resolved = await t.query(
      internal.storage.files.getPublishedEmailImage,
      {storageId},
    );
    expect(resolved?.contentType).toBe('application/octet-stream');
  });
});
