// @vitest-environment node

import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const REDIRECTS_PATH = new URL(
  '../frontend/public/_redirects',
  import.meta.url,
);

function parseRedirectRules(): string[][] {
  return readFileSync(REDIRECTS_PATH, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/));
}

describe('Cloudflare Pages routing', () => {
  it('keeps the global SPA fallback for Angular not-found deep links', () => {
    const redirectRules = parseRedirectRules();

    expect(redirectRules).toContainEqual(['/*', '/index.html', '200']);
  });

  it('routes root bundle requests through the asset miss guard before redirects', () => {
    const routesConfig = JSON.parse(
      readFileSync(
        new URL('../frontend/public/_routes.json', import.meta.url),
        'utf8',
      ),
    ) as {include?: string[]};

    expect(routesConfig.include).toEqual(
      expect.arrayContaining(['/*.js', '/*.css']),
    );
  });
});
