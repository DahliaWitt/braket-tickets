import {afterEach, describe, expect, it} from 'vitest';
import {
  digestBearerToken,
  generateBearerToken,
  tokenPrefix,
} from './token_digests';

const ORIGINAL_SECRET = process.env['TOKEN_DIGEST_SECRET'];

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env['TOKEN_DIGEST_SECRET'];
  } else {
    process.env['TOKEN_DIGEST_SECRET'] = ORIGINAL_SECRET;
  }
});

describe('token_digests', () => {
  it('generates URL-safe high-entropy bearer tokens', () => {
    const token = generateBearerToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
  });

  it('produces deterministic purpose-scoped digests', async () => {
    process.env['TOKEN_DIGEST_SECRET'] = 'test-digest-secret';

    const first = await digestBearerToken('magic_link', 'raw-token');
    const second = await digestBearerToken('magic_link', 'raw-token');
    const otherPurpose = await digestBearerToken('admin_invite', 'raw-token');

    expect(first).toBe(second);
    expect(first).not.toBe(otherPurpose);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when the digest secret is missing', async () => {
    delete process.env['TOKEN_DIGEST_SECRET'];

    await expect(digestBearerToken('magic_link', 'raw-token')).rejects.toThrow(
      'TOKEN_DIGEST_SECRET is required',
    );
  });

  it('returns only a short display prefix', () => {
    expect(tokenPrefix('abcdef123456')).toBe('abcdef12');
  });
});
