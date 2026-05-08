import path from 'path';

import {describe, expect, it} from 'vitest';

import {parseFrontendScreenshotArgs} from './lib/frontendScreenshotOptions';

const PROJECT_ROOT = '/tmp/braket-tickets';

describe('parseFrontendScreenshotArgs', () => {
  it('builds defaults from a positional route', () => {
    expect(
      parseFrontendScreenshotArgs(['/community-admin/events'], PROJECT_ROOT),
    ).toEqual({
      auth: 'none',
      fullPage: true,
      outPath: path.join(
        PROJECT_ROOT,
        'frontend',
        '__screenshots__',
        'community-admin-events.png',
      ),
      route: '/community-admin/events',
      selector: null,
      timeoutMs: 15_000,
      waitForText: null,
    });
  });

  it('supports explicit auth and relative output paths', () => {
    expect(
      parseFrontendScreenshotArgs(
        [
          '/account',
          '--auth',
          'user',
          '--out',
          'artifacts/account.png',
          '--viewport',
        ],
        PROJECT_ROOT,
      ),
    ).toEqual({
      auth: 'user',
      fullPage: false,
      outPath: path.join(PROJECT_ROOT, 'artifacts', 'account.png'),
      route: '/account',
      selector: null,
      timeoutMs: 15_000,
      waitForText: null,
    });
  });

  it('ignores a bare pnpm passthrough separator', () => {
    expect(
      parseFrontendScreenshotArgs(
        ['--', '/admin', '--auth', 'admin', '--wait-for-text', 'Dashboard'],
        PROJECT_ROOT,
      ),
    ).toEqual({
      auth: 'admin',
      fullPage: true,
      outPath: path.join(
        PROJECT_ROOT,
        'frontend',
        '__screenshots__',
        'admin.png',
      ),
      route: '/admin',
      selector: null,
      timeoutMs: 15_000,
      waitForText: 'Dashboard',
    });
  });

  it('rejects unknown auth modes', () => {
    expect(() =>
      parseFrontendScreenshotArgs(
        ['/account', '--auth', 'staff'],
        PROJECT_ROOT,
      ),
    ).toThrow('Invalid --auth value: staff');
  });

  it('rejects routes that do not start with a slash', () => {
    expect(() =>
      parseFrontendScreenshotArgs(['account'], PROJECT_ROOT),
    ).toThrow('Route must start with "/"');
  });
});
