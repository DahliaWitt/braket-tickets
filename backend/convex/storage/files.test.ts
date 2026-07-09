import {describe, it, expect} from 'vitest';
import {convexTest} from '../setup.testing';
import {api, internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {checkMagicBytes} from './files';
import {
  assertUploadConfirmed,
  cleanupReplacedUpload,
} from '../lib/upload_validation';
import {recordPublishedEmailImages} from '../lib/email/rich_text_images';

/**
 * Unit tests for convex/storage/files.ts
 *
 * Tests cover:
 * - File upload URL generation (authentication required)
 * - File validation (size limits, MIME type restrictions)
 */

/**
 * Helper to create a test user and return the convex test instance with identity
 */
async function createAuthenticatedUser() {
  const t = convexTest();
  const userId = await t.mutation(api.testing.users.createUserDirectly, {
    email: 'test@example.com',
    name: 'Test User',
  });
  return {t, userId, asUser: t.withIdentity({subject: userId})};
}

describe('files', () => {
  describe('generateUploadUrl', () => {
    it('returns upload URL for authenticated user', async () => {
      const {asUser} = await createAuthenticatedUser();

      const uploadUrl = await asUser.mutation(
        api.storage.files.generateUploadUrl,
        {},
      );

      expect(typeof uploadUrl).toBe('string');
      expect(uploadUrl.length).toBeGreaterThan(0);
    });

    it('throws for unauthenticated user', async () => {
      const t = convexTest();

      await expect(
        t.mutation(api.storage.files.generateUploadUrl, {}),
      ).rejects.toThrow('Unauthenticated');
    });

    it('rate limit blocks after 10 requests per minute', async () => {
      const {asUser} = await createAuthenticatedUser();

      // First 10 calls consume the full rate limit budget
      for (let i = 0; i < 10; i++) {
        const url = await asUser.mutation(
          api.storage.files.generateUploadUrl,
          {},
        );
        expect(typeof url).toBe('string');
      }

      // 11th call exceeds the limit
      await expect(
        asUser.mutation(api.storage.files.generateUploadUrl, {}),
      ).rejects.toThrow();
    });
  });

  describe('validateUpload', () => {
    describe('authentication', () => {
      it('returns error for unauthenticated user', async () => {
        const t = convexTest();

        const result = await t.mutation(api.storage.files.validateUpload, {
          fileName: 'test.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1000,
        });

        expect(result).toEqual({
          valid: false,
          error: 'Unauthenticated',
        });
      });
    });

    describe('file size validation', () => {
      it('accepts file exactly at 10MB limit', async () => {
        const {asUser} = await createAuthenticatedUser();

        const result = await asUser.mutation(api.storage.files.validateUpload, {
          fileName: 'test.jpg',
          mimeType: 'image/jpeg',
          fileSize: 10 * 1024 * 1024, // 10MB exactly
        });

        expect(result).toEqual({valid: true});
      });

      it('rejects file over 10MB limit', async () => {
        const {asUser} = await createAuthenticatedUser();

        const result = await asUser.mutation(api.storage.files.validateUpload, {
          fileName: 'large.jpg',
          mimeType: 'image/jpeg',
          fileSize: 10 * 1024 * 1024 + 1, // 10MB + 1 byte
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain('File too large');
        expect(result.error).toContain('10MB');
      });
    });

    describe('MIME type validation', () => {
      it('accepts an allowed image MIME type', async () => {
        const {asUser} = await createAuthenticatedUser();
        const result = await asUser.mutation(api.storage.files.validateUpload, {
          fileName: 'test.webp',
          mimeType: 'image/webp',
          fileSize: 1000,
        });
        expect(result).toEqual({valid: true});
      });

      it('rejects image/svg+xml', async () => {
        const {asUser} = await createAuthenticatedUser();
        const result = await asUser.mutation(api.storage.files.validateUpload, {
          fileName: 'test.svg',
          mimeType: 'image/svg+xml',
          fileSize: 1000,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file type');
        expect(result.error).toContain('JPG');
        expect(result.error).toContain('PNG');
        expect(result.error).toContain('GIF');
        expect(result.error).toContain('WEBP');
      });

      it('rejects uppercase MIME type (strict matching)', async () => {
        const {asUser} = await createAuthenticatedUser();
        const result = await asUser.mutation(api.storage.files.validateUpload, {
          fileName: 'test.jpg',
          mimeType: 'IMAGE/JPEG',
          fileSize: 1000,
        });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file type');
      });
    });

    describe('combined validation', () => {
      it('validates size before MIME type', async () => {
        const {asUser} = await createAuthenticatedUser();

        const result = await asUser.mutation(api.storage.files.validateUpload, {
          fileName: 'huge.pdf',
          mimeType: 'application/pdf', // Invalid MIME
          fileSize: 20 * 1024 * 1024, // Also too large
        });

        expect(result.valid).toBe(false);
        // Size validation happens first in the code
        expect(result.error).toContain('File too large');
      });
    });
  });

  describe('checkMagicBytes', () => {
    // ---- JPEG ----
    it('accepts valid JPEG magic bytes', () => {
      const bytes = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
      ]);
      expect(checkMagicBytes(bytes, 'image/jpeg')).toEqual({valid: true});
    });

    it('rejects JPEG claim with PNG bytes', () => {
      const bytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const result = checkMagicBytes(bytes, 'image/jpeg');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/magic bytes/i);
    });

    // ---- PNG ----
    it('accepts valid PNG magic bytes', () => {
      const bytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
      ]);
      expect(checkMagicBytes(bytes, 'image/png')).toEqual({valid: true});
    });

    it('rejects PNG claim with JPEG bytes', () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const result = checkMagicBytes(bytes, 'image/png');
      expect(result.valid).toBe(false);
    });

    it('rejects PNG claim with too-short buffer (< 8 bytes)', () => {
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const result = checkMagicBytes(bytes, 'image/png');
      expect(result.valid).toBe(false);
    });

    // ---- GIF ----
    it('accepts valid GIF87a magic bytes', () => {
      const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]);
      expect(checkMagicBytes(bytes, 'image/gif')).toEqual({valid: true});
    });

    it('accepts valid GIF89a magic bytes', () => {
      const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      expect(checkMagicBytes(bytes, 'image/gif')).toEqual({valid: true});
    });

    it('rejects GIF claim with invalid version byte (GIF8X — not 87a or 89a)', () => {
      // 0x58 = 'X' — not a valid GIF version byte
      const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x58, 0x61]);
      const result = checkMagicBytes(bytes, 'image/gif');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/magic bytes/i);
    });

    // ---- WebP ----
    it('accepts valid WebP magic bytes', () => {
      const bytes = new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // RIFF
        0x00,
        0x00,
        0x00,
        0x00, // file size (ignored)
        0x57,
        0x45,
        0x42,
        0x50, // WEBP
      ]);
      expect(checkMagicBytes(bytes, 'image/webp')).toEqual({valid: true});
    });

    it('rejects WebP claim with RIFF but wrong fourcc', () => {
      const bytes = new Uint8Array([
        0x52,
        0x49,
        0x46,
        0x46, // RIFF
        0x00,
        0x00,
        0x00,
        0x00,
        0x41,
        0x56,
        0x49,
        0x20, // AVI (not WEBP)
      ]);
      const result = checkMagicBytes(bytes, 'image/webp');
      expect(result.valid).toBe(false);
    });

    it('rejects WebP claim with too-short buffer (< 12 bytes)', () => {
      const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00]);
      const result = checkMagicBytes(bytes, 'image/webp');
      expect(result.valid).toBe(false);
    });

    // ---- Unsupported types ----
    it('rejects SVG magic-byte checks as an unsupported type', () => {
      const text = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      const bytes = new TextEncoder().encode(text);
      const result = checkMagicBytes(bytes, 'image/svg+xml');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unsupported.*type/i);
    });

    // ---- Edge cases ----
    it('rejects empty buffer', () => {
      const bytes = new Uint8Array(0);
      const result = checkMagicBytes(bytes, 'image/jpeg');
      expect(result.valid).toBe(false);
    });

    it('returns error for unknown MIME type', () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
      const result = checkMagicBytes(bytes, 'application/pdf');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unsupported.*type/i);
    });
  }); // end describe('checkMagicBytes')

  describe('_deleteStoredFile', () => {
    it('deletes a stored file from storage', async () => {
      const {t} = await createAuthenticatedUser();

      // Store a test file — ctx.storage.store() works in t.run() in this test env
      const storageId = await t.run(async (ctx) => {
        const blob = new Blob(['fake image data'], {type: 'image/jpeg'});
        return await ctx.storage.store(blob);
      });

      // Verify it exists
      const urlBefore = await t.run(async (ctx) =>
        ctx.storage.getUrl(storageId),
      );
      expect(urlBefore).not.toBeNull();

      // Delete it
      await t.run(async (ctx) => {
        await ctx.runMutation(internal.storage.files._deleteStoredFile, {
          storageId,
        });
      });

      // Verify it's gone
      const urlAfter = await t.run(async (ctx) =>
        ctx.storage.getUrl(storageId),
      );
      expect(urlAfter).toBeNull();
    });
  });

  describe('confirmUpload', () => {
    describe('authentication', () => {
      it('throws for unauthenticated caller', async () => {
        const t = convexTest();

        // Store a real file so the ID validator passes; auth check happens in handler
        const storageId = await t.run(async (ctx) => {
          const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
            type: 'image/jpeg',
          });
          return await ctx.storage.store(blob);
        });

        await expect(
          t.action(api.storage.files.confirmUpload, {
            storageId,
            mimeType: 'image/jpeg',
          }),
        ).rejects.toThrow(/unauthenticated/i);
      });
    });

    describe('MIME type allow-list enforcement', () => {
      it('returns error for disallowed MIME type without reading storage', async () => {
        const {t, asUser} = await createAuthenticatedUser();

        // Store a real file so the ID validator passes; MIME check happens before storage read
        const storageId = await t.run(async (ctx) => {
          const blob = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], {
            type: 'application/pdf',
          });
          return await ctx.storage.store(blob);
        });

        const result = await asUser.action(api.storage.files.confirmUpload, {
          storageId,
          mimeType: 'application/pdf',
        });

        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/Invalid file type/i);
      });

      it('returns error for video/mp4', async () => {
        const {t, asUser} = await createAuthenticatedUser();

        const storageId = await t.run(async (ctx) => {
          const blob = new Blob([new Uint8Array([0x00, 0x00, 0x00, 0x18])], {
            type: 'video/mp4',
          });
          return await ctx.storage.store(blob);
        });

        const result = await asUser.action(api.storage.files.confirmUpload, {
          storageId,
          mimeType: 'video/mp4',
        });

        expect(result.valid).toBe(false);
      });
    });

    describe('magic byte validation', () => {
      async function storeTestFile(
        t: ReturnType<typeof convexTest>,
        bytes: Uint8Array,
        mimeType: string,
      ): Promise<Id<'_storage'>> {
        return await t.run(async (ctx) => {
          const blob = new Blob([bytes.buffer as ArrayBuffer], {
            type: mimeType,
          });
          return await ctx.storage.store(blob);
        });
      }

      it('accepts a valid JPEG file', async () => {
        const {t, asUser, userId} = await createAuthenticatedUser();

        const jpegBytes = new Uint8Array([
          0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
          0x01,
        ]);
        const storageId = await storeTestFile(t, jpegBytes, 'image/jpeg');

        const result = await asUser.action(api.storage.files.confirmUpload, {
          storageId,
          mimeType: 'image/jpeg',
        });

        expect(result.valid).toBe(true);
        expect(result.storageId).toBe(storageId);
        // Success now surfaces a durable public URL for the confirmed file.
        expect(typeof result.url).toBe('string');
        expect(result.url).toBeTruthy();

        const confirmationRecord = await t.run(async (ctx) => {
          return await ctx.db
            .query('confirmedUploads')
            .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
            .unique();
        });
        expect(confirmationRecord?.uploaderUserId).toBe(userId);
      });

      it('accepts a valid PNG file', async () => {
        const {t, asUser} = await createAuthenticatedUser();

        const pngBytes = new Uint8Array([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
        ]);
        const storageId = await storeTestFile(t, pngBytes, 'image/png');

        const result = await asUser.action(api.storage.files.confirmUpload, {
          storageId,
          mimeType: 'image/png',
        });

        expect(result.valid).toBe(true);
        expect(result.storageId).toBe(storageId);
        expect(typeof result.url).toBe('string');
        expect(result.url).toBeTruthy();
      });

      it('rejects a JPEG file claimed as PNG (deletes it)', async () => {
        const {t, asUser} = await createAuthenticatedUser();

        const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
        const storageId = await storeTestFile(t, jpegBytes, 'image/jpeg');

        const result = await asUser.action(api.storage.files.confirmUpload, {
          storageId,
          mimeType: 'image/png',
        });

        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/magic bytes/i);

        // Verify the file was deleted
        const urlAfter = await t.run(async (ctx) =>
          ctx.storage.getUrl(storageId),
        );
        expect(urlAfter).toBeNull();
      });

      it('rejects a PE executable disguised as JPEG (deletes it)', async () => {
        const {t, asUser} = await createAuthenticatedUser();

        // Windows PE magic bytes (MZ header)
        const exeBytes = new Uint8Array([
          0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00,
        ]);
        const storageId = await storeTestFile(t, exeBytes, 'image/jpeg');

        const result = await asUser.action(api.storage.files.confirmUpload, {
          storageId,
          mimeType: 'image/jpeg',
        });

        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/magic bytes/i);

        const urlAfter = await t.run(async (ctx) =>
          ctx.storage.getUrl(storageId),
        );
        expect(urlAfter).toBeNull();
      });

      it('rejects an SVG file before reading it as a confirmed upload type', async () => {
        const {t, asUser} = await createAuthenticatedUser();

        const svgContent =
          '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
        const svgBytes = new TextEncoder().encode(svgContent);
        const storageId = await storeTestFile(t, svgBytes, 'image/svg+xml');

        const result = await asUser.action(api.storage.files.confirmUpload, {
          storageId,
          mimeType: 'image/svg+xml',
        });

        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid file type');
      });

      it('returns error for non-existent storageId', async () => {
        const {t, asUser} = await createAuthenticatedUser();

        // Store a file and delete it so we have a valid ID format that no longer exists
        const storageId = await t.run(async (ctx) => {
          const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
            type: 'image/jpeg',
          });
          const id = await ctx.storage.store(blob);
          await ctx.storage.delete(id);
          return id;
        });

        const result = await asUser.action(api.storage.files.confirmUpload, {
          storageId,
          mimeType: 'image/jpeg',
        });

        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/not found|does not exist/i);
      });

      it('rejects confirmation of a blob already confirmed by another user', async () => {
        const {t, asUser} = await createAuthenticatedUser();
        const secondUser = t.withIdentity({
          subject: await t.mutation(api.testing.users.createUserDirectly, {
            email: 'second@example.com',
            name: 'Second User',
          }),
        });

        const jpegBytes = new Uint8Array([
          0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
          0x01,
        ]);
        const storageId = await storeTestFile(t, jpegBytes, 'image/jpeg');

        const firstResult = await asUser.action(
          api.storage.files.confirmUpload,
          {
            storageId,
            mimeType: 'image/jpeg',
          },
        );
        expect(firstResult.valid).toBe(true);
        expect(firstResult.storageId).toBe(storageId);

        const secondResult = await secondUser.action(
          api.storage.files.confirmUpload,
          {
            storageId,
            mimeType: 'image/jpeg',
          },
        );
        expect(secondResult.valid).toBe(false);
        expect(secondResult.error).toMatch(
          /already confirmed for a different user/i,
        );
      });

      it('rejects confirming a legacy upload record without uploader ownership', async () => {
        const {t, asUser} = await createAuthenticatedUser();

        const jpegBytes = new Uint8Array([
          0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
          0x01,
        ]);
        const storageId = await storeTestFile(t, jpegBytes, 'image/jpeg');

        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally testing legacy confirmedUploads record without uploaderUserId; no production path creates this shape
        await t.run(async (ctx) => {
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test setup for confirmedUploads
          await ctx.db.insert('confirmedUploads', {
            storageId,
            confirmedAt: Date.now(),
          });
        });

        const result = await asUser.action(api.storage.files.confirmUpload, {
          storageId,
          mimeType: 'image/jpeg',
        });

        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/upload the file again/i);

        const confirmationRecord = await t.run(async (ctx) => {
          return await ctx.db
            .query('confirmedUploads')
            .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
            .unique();
        });
        expect(confirmationRecord?.uploaderUserId).toBeUndefined();
      });
    });
  });

  describe('assertUploadConfirmed', () => {
    it('rejects reuse of a confirmed upload by a different user', async () => {
      const {t, asUser, userId} = await createAuthenticatedUser();
      const secondUserId = await t.mutation(
        api.testing.users.createUserDirectly,
        {
          email: 'other@example.com',
          name: 'Other User',
        },
      );

      const jpegBytes = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const storageId = await t.run(async (ctx) => {
        const blob = new Blob([jpegBytes.buffer as ArrayBuffer], {
          type: 'image/jpeg',
        });
        return await ctx.storage.store(blob);
      });

      await asUser.action(api.storage.files.confirmUpload, {
        storageId,
        mimeType: 'image/jpeg',
      });

      await expect(
        t.run(async (ctx) => {
          await assertUploadConfirmed(
            ctx.db,
            storageId,
            'poster',
            secondUserId,
          );
        }),
      ).rejects.toThrow(/poster: file was not validated by the current user/i);

      await expect(
        t.run(async (ctx) => {
          await assertUploadConfirmed(ctx.db, storageId, 'poster', userId);
        }),
      ).resolves.toBeNull();
    });
  });

  describe('confirmUpload size enforcement', () => {
    it('rejects an oversized file with valid magic bytes', async () => {
      const {t, asUser} = await createAuthenticatedUser();

      const oversizedData = new Uint8Array(10 * 1024 * 1024 + 1);
      // Valid JPEG header
      oversizedData.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const storageId = await t.run(async (ctx) => {
        const blob = new Blob([oversizedData.buffer as ArrayBuffer], {
          type: 'image/jpeg',
        });
        return await ctx.storage.store(blob);
      });

      const result = await asUser.action(api.storage.files.confirmUpload, {
        storageId,
        mimeType: 'image/jpeg',
      });

      expect(result.valid).toBe(false);
      expect(result.error).toContain('File too large');
      expect(result.error).toContain('10MB');
    });

    it('deletes oversized file from storage on rejection', async () => {
      const {t, asUser} = await createAuthenticatedUser();

      const oversizedData = new Uint8Array(10 * 1024 * 1024 + 1);
      oversizedData.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const storageId = await t.run(async (ctx) => {
        const blob = new Blob([oversizedData.buffer as ArrayBuffer], {
          type: 'image/jpeg',
        });
        return await ctx.storage.store(blob);
      });

      await asUser.action(api.storage.files.confirmUpload, {
        storageId,
        mimeType: 'image/jpeg',
      });

      const urlAfter = await t.run(async (ctx) =>
        ctx.storage.getUrl(storageId),
      );
      expect(urlAfter).toBeNull();
    });

    it('does not create a confirmedUploads record for oversized file', async () => {
      const {t, asUser} = await createAuthenticatedUser();

      const oversizedData = new Uint8Array(10 * 1024 * 1024 + 1);
      oversizedData.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const storageId = await t.run(async (ctx) => {
        const blob = new Blob([oversizedData.buffer as ArrayBuffer], {
          type: 'image/jpeg',
        });
        return await ctx.storage.store(blob);
      });

      await asUser.action(api.storage.files.confirmUpload, {
        storageId,
        mimeType: 'image/jpeg',
      });

      const record = await t.run(async (ctx) =>
        ctx.db
          .query('confirmedUploads')
          .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
          .first(),
      );
      expect(record).toBeNull();
    });

    it('accepts a file exactly at the 10MB limit', async () => {
      const {t, asUser} = await createAuthenticatedUser();

      const exactLimitData = new Uint8Array(10 * 1024 * 1024);
      exactLimitData.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const storageId = await t.run(async (ctx) => {
        const blob = new Blob([exactLimitData.buffer as ArrayBuffer], {
          type: 'image/jpeg',
        });
        return await ctx.storage.store(blob);
      });

      const result = await asUser.action(api.storage.files.confirmUpload, {
        storageId,
        mimeType: 'image/jpeg',
      });

      expect(result.valid).toBe(true);
      expect(result.storageId).toBe(storageId);
      expect(typeof result.url).toBe('string');
      expect(result.url).toBeTruthy();
    });
  });

  describe('cleanupReplacedUpload', () => {
    it('deletes the old stored file and confirmedUploads record', async () => {
      const {t, asUser} = await createAuthenticatedUser();

      const jpegBytes = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const storageId = await t.run(async (ctx) => {
        const blob = new Blob([jpegBytes.buffer as ArrayBuffer], {
          type: 'image/jpeg',
        });
        return await ctx.storage.store(blob);
      });

      await asUser.action(api.storage.files.confirmUpload, {
        storageId,
        mimeType: 'image/jpeg',
      });

      // Verify file and record exist before cleanup
      const urlBefore = await t.run(async (ctx) =>
        ctx.storage.getUrl(storageId),
      );
      expect(urlBefore).not.toBeNull();

      const recordBefore = await t.run(async (ctx) =>
        ctx.db
          .query('confirmedUploads')
          .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
          .first(),
      );
      expect(recordBefore).not.toBeNull();

      // Run cleanup
      await t.run(async (ctx) => {
        await cleanupReplacedUpload(ctx, storageId);
        return null;
      });

      // Verify both are deleted
      const urlAfter = await t.run(async (ctx) =>
        ctx.storage.getUrl(storageId),
      );
      expect(urlAfter).toBeNull();

      const recordAfter = await t.run(async (ctx) =>
        ctx.db
          .query('confirmedUploads')
          .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
          .first(),
      );
      expect(recordAfter).toBeNull();
    });

    it('handles already-deleted files gracefully', async () => {
      const {t} = await createAuthenticatedUser();

      const storageId = await t.run(async (ctx) => {
        const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], {
          type: 'image/jpeg',
        });
        const id = await ctx.storage.store(blob);
        await ctx.storage.delete(id);
        return id;
      });

      // Should not throw
      await t.run(async (ctx) => {
        await cleanupReplacedUpload(ctx, storageId);
        return null;
      });
    });

    it('pins files published in a sent rich email (skips deletion entirely)', async () => {
      const {t, asUser} = await createAuthenticatedUser();

      const jpegBytes = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const storageId = await t.run(async (ctx) => {
        const blob = new Blob([jpegBytes.buffer as ArrayBuffer], {
          type: 'image/jpeg',
        });
        return await ctx.storage.store(blob);
      });
      await asUser.action(api.storage.files.confirmUpload, {
        storageId,
        mimeType: 'image/jpeg',
      });
      // Mark the upload as published in a sent email (the send-handler step).
      await t.run((ctx) => recordPublishedEmailImages(ctx, [storageId]));

      await t.run(async (ctx) => {
        await cleanupReplacedUpload(ctx, storageId);
        return null;
      });

      // Blob AND confirmation record both survive: sent emails reference the
      // blob via durable /api/images URLs, so entity cleanup must not touch it.
      const urlAfter = await t.run(async (ctx) =>
        ctx.storage.getUrl(storageId),
      );
      expect(urlAfter).not.toBeNull();
      const recordAfter = await t.run(async (ctx) =>
        ctx.db
          .query('confirmedUploads')
          .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
          .first(),
      );
      expect(recordAfter).not.toBeNull();
    });
  });

  describe('_cleanupOrphanedUploads', () => {
    it('runs without error on empty storage', async () => {
      const {t} = await createAuthenticatedUser();

      await t.run(async (ctx) => {
        await ctx.runMutation(
          internal.storage.files._cleanupOrphanedUploads,
          {},
        );
      });
    });

    it('does not delete confirmed files', async () => {
      const {t, asUser} = await createAuthenticatedUser();

      const jpegBytes = new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      ]);
      const storageId = await t.run(async (ctx) => {
        const blob = new Blob([jpegBytes.buffer as ArrayBuffer], {
          type: 'image/jpeg',
        });
        return await ctx.storage.store(blob);
      });

      await asUser.action(api.storage.files.confirmUpload, {
        storageId,
        mimeType: 'image/jpeg',
      });

      await t.run(async (ctx) => {
        await ctx.runMutation(
          internal.storage.files._cleanupOrphanedUploads,
          {},
        );
      });

      // Confirmed file should still exist
      const url = await t.run(async (ctx) => ctx.storage.getUrl(storageId));
      expect(url).not.toBeNull();
    });
  });
});
