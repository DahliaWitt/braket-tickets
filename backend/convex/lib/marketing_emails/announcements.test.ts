import {afterEach, describe, expect, it} from 'vitest';
import {resolveEmailApiBaseUrl} from '../../lib/public_site_urls';

const ORIGINAL_CONVEX_SITE_URL = process.env['CONVEX_SITE_URL'];
const ORIGINAL_AUTH_BASE_URL = process.env['AUTH_BASE_URL'];

afterEach(() => {
  if (ORIGINAL_CONVEX_SITE_URL === undefined) {
    delete process.env['CONVEX_SITE_URL'];
  } else {
    process.env['CONVEX_SITE_URL'] = ORIGINAL_CONVEX_SITE_URL;
  }

  if (ORIGINAL_AUTH_BASE_URL === undefined) {
    delete process.env['AUTH_BASE_URL'];
  } else {
    process.env['AUTH_BASE_URL'] = ORIGINAL_AUTH_BASE_URL;
  }
});

describe('resolveEmailApiBaseUrl', () => {
  it('prefers CONVEX_SITE_URL over the frontend site URL for email API links', () => {
    process.env['CONVEX_SITE_URL'] = 'http://127.0.0.1:3211';
    process.env['AUTH_BASE_URL'] = 'http://127.0.0.1:3210';

    expect(resolveEmailApiBaseUrl('http://127.0.0.1:4200')).toBe(
      'http://127.0.0.1:3211',
    );
  });

  it('falls back to AUTH_BASE_URL when CONVEX_SITE_URL is unset', () => {
    delete process.env['CONVEX_SITE_URL'];
    process.env['AUTH_BASE_URL'] = 'https://fallback-deployment.convex.site';

    expect(resolveEmailApiBaseUrl('https://braket.gay')).toBe(
      'https://fallback-deployment.convex.site',
    );
  });

  it('falls back to the frontend site URL when no API base URL is configured', () => {
    delete process.env['CONVEX_SITE_URL'];
    delete process.env['AUTH_BASE_URL'];

    expect(resolveEmailApiBaseUrl('https://braket.gay')).toBe('https://braket.gay');
  });
});
