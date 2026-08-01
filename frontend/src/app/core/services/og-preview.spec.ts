import {afterEach, describe, expect, it, vi} from 'vitest';
import type {PublicEventPreview} from '@shared/contracts/public-event';
import type {PagesAssetEnvironment} from '../../../../functions/asset-miss';
import {
  applyEventPreview,
  escapeHtml,
  isValidEventId,
  matchEventPreviewPath,
  rewriteShellHtml,
} from '../../../../functions/og-preview';

// Mirrors the actual <head> meta section of frontend/src/index.html so the
// string-replace targets exercised here are honest about what the real
// shell looks like (property/name-keyed, not content-keyed).
const CSP_HEADER_VALUE =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com https://connect-js.stripe.com https://static.cloudflareinsights.com https://browser.sentry-cdn.com https://js.sentry-cdn.com; connect-src 'self' wss://*.convex.cloud wss://*.convex.site https://*.convex.cloud https://*.convex.site https://*.ingest.sentry.io https://*.sentry.io https://api.stripe.com https://cloudflareinsights.com https://browser.sentry-cdn.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.convex.cloud https://*.stripe.com; frame-src https://js.stripe.com https://*.js.stripe.com https://connect-js.stripe.com https://hooks.stripe.com https://www.youtube-nocookie.com; worker-src 'self' blob:; child-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'";

function buildShellHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Braket Community</title>
    <base href="/" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href="ball.png" />
    <meta
      name="description"
      content="Braket Community is a ticketing and vetting platform for community-run events."
    />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Braket Community" />
    <meta
      property="og:description"
      content="Braket Community is a ticketing and vetting platform for community-run events."
    />
    <meta
      property="og:image"
      content="https://community.braket.gay/logo_black.png"
    />
    <meta property="og:url" content="https://community.braket.gay/" />
    <meta name="twitter:card" content="summary" />
  </head>
  <body>
    <app-root></app-root>
  </body>
</html>
`;
}

function buildAssetResponse(html: string): Response {
  const bytes = new TextEncoder().encode(html);
  return new Response(html, {
    status: 200,
    statusText: 'OK',
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP_HEADER_VALUE,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Length': String(bytes.byteLength),
      ETag: '"shell-etag-123"',
    },
  });
}

function buildEnv(
  overrides: Partial<PagesAssetEnvironment> = {},
): PagesAssetEnvironment {
  return {
    ASSETS: {fetch: async () => new Response('unused')},
    CONVEX_SITE_URL: 'https://modest-impala-722.convex.site',
    ...overrides,
  };
}

/**
 * Extracts a meta tag's `content` attribute value by first locating the
 * whole tag via its `property`/`name` attribute, then reading `content`
 * from within that match — robust to the tag's attributes being wrapped
 * across multiple lines (as the real shell's longer tags are).
 */
function getMetaContent(html: string, attributeMatcher: RegExp): string | null {
  const tagMatch = attributeMatcher.exec(html);
  if (!tagMatch) {
    return null;
  }
  const contentMatch = /content="([^"]*)"/.exec(tagMatch[0]);
  return contentMatch ? (contentMatch[1] ?? null) : null;
}

const OG_TITLE_TAG = /<meta\b[^>]*\bproperty="og:title"[^>]*>/;
const OG_DESCRIPTION_TAG = /<meta\b[^>]*\bproperty="og:description"[^>]*>/;
const OG_IMAGE_TAG = /<meta\b[^>]*\bproperty="og:image"[^>]*>/;
const OG_IMAGE_ALT_TAG = /<meta\b[^>]*\bproperty="og:image:alt"[^>]*>/;
const OG_URL_TAG = /<meta\b[^>]*\bproperty="og:url"[^>]*>/;
const TWITTER_CARD_TAG = /<meta\b[^>]*\bname="twitter:card"[^>]*>/;

function buildPreview(
  overrides: Partial<PublicEventPreview> = {},
): PublicEventPreview {
  return {
    _id: 'event123' as PublicEventPreview['_id'],
    title: 'Warehouse Rager',
    description: 'A very good time indeed.',
    date: '2026-08-15T02:00:00.000Z',
    dateLabel: 'Aug 14, 9:00 PM – Aug 15, 2:00 AM',
    location: 'The Warehouse',
    posterUrl: 'https://files.convex.cloud/poster.png',
    organizerName: 'Warehouse Collective',
    ...overrides,
  };
}

describe('matchEventPreviewPath', () => {
  it('accepts /events/:id', () => {
    expect(matchEventPreviewPath('/events/abc123')).toBe('abc123');
  });

  it('accepts a trailing slash', () => {
    expect(matchEventPreviewPath('/events/abc123/')).toBe('abc123');
  });

  it('accepts underscores and dashes', () => {
    expect(matchEventPreviewPath('/events/abc_123-XYZ')).toBe('abc_123-XYZ');
  });

  it('rejects a bare /events path with no id', () => {
    expect(matchEventPreviewPath('/events/')).toBeNull();
    expect(matchEventPreviewPath('/events')).toBeNull();
  });

  it('rejects nested paths', () => {
    expect(matchEventPreviewPath('/events/abc/manage')).toBeNull();
  });

  it('rejects unrelated paths', () => {
    expect(matchEventPreviewPath('/about')).toBeNull();
    expect(matchEventPreviewPath('/community-admin/events/abc')).toBeNull();
  });

  it('rejects ids containing path-traversal or query characters', () => {
    expect(matchEventPreviewPath('/events/abc%20123')).toBeNull();
    expect(matchEventPreviewPath('/events/../secrets')).toBeNull();
  });
});

describe('isValidEventId', () => {
  it('accepts the allowed charset', () => {
    expect(isValidEventId('abc-123_XYZ')).toBe(true);
  });

  it('rejects slashes, query, and fragment characters', () => {
    expect(isValidEventId('abc/def')).toBe(false);
    expect(isValidEventId('abc?x=1')).toBe(false);
    expect(isValidEventId('abc#frag')).toBe(false);
    expect(isValidEventId('abc%20')).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(isValidEventId('')).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('renders an XSS payload inert', () => {
    expect(escapeHtml('"><script>alert(1)</script>')).toBe(
      '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes ampersands and single quotes', () => {
    expect(escapeHtml(`Tom & Jerry's`)).toBe('Tom &amp; Jerry&#39;s');
  });
});

describe('rewriteShellHtml', () => {
  const pageUrl = new URL('https://community.braket.gay/events/abc123');

  it('rewrites title, og:title, og:description, og:image, og:url, og:image:alt, and twitter:card', () => {
    const html = rewriteShellHtml(buildShellHtml(), buildPreview(), pageUrl);

    expect(html).toContain('<title>Warehouse Rager · Braket</title>');
    expect(getMetaContent(html, OG_TITLE_TAG)).toBe('Warehouse Rager · Braket');
    expect(getMetaContent(html, OG_DESCRIPTION_TAG)).toBe(
      'Aug 14, 9:00 PM – Aug 15, 2:00 AM · The Warehouse — A very good time indeed.',
    );
    expect(getMetaContent(html, OG_IMAGE_TAG)).toBe(
      'https://files.convex.cloud/poster.png',
    );
    expect(getMetaContent(html, OG_URL_TAG)).toBe(
      'https://community.braket.gay/events/abc123',
    );
    expect(getMetaContent(html, OG_IMAGE_ALT_TAG)).toBe(
      'Warehouse Rager flier',
    );
    expect(getMetaContent(html, TWITTER_CARD_TAG)).toBe('summary_large_image');
  });

  it('renders an organizer-controlled title with a script tag inert', () => {
    const html = rewriteShellHtml(
      buildShellHtml(),
      buildPreview({title: 'Party"><script>alert(1)</script>'}),
      pageUrl,
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain(
      '<title>Party&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; · Braket</title>',
    );
  });

  it('leaves og:image and twitter:card untouched, and omits og:image:alt, when there is no poster', () => {
    const html = rewriteShellHtml(
      buildShellHtml(),
      buildPreview({posterUrl: null}),
      pageUrl,
    );

    expect(getMetaContent(html, OG_IMAGE_TAG)).toBe(
      'https://community.braket.gay/logo_black.png',
    );
    expect(getMetaContent(html, TWITTER_CARD_TAG)).toBe('summary');
    expect(html).not.toContain('og:image:alt');
  });

  it('treats a non-https posterUrl as absent (defense in depth)', () => {
    const html = rewriteShellHtml(
      buildShellHtml(),
      buildPreview({posterUrl: 'http://insecure.example/poster.png'}),
      pageUrl,
    );

    expect(getMetaContent(html, OG_IMAGE_TAG)).toBe(
      'https://community.braket.gay/logo_black.png',
    );
    expect(getMetaContent(html, TWITTER_CARD_TAG)).toBe('summary');
    expect(html).not.toContain('og:image:alt');
  });

  it('builds og:description from dateLabel alone when location and description are absent', () => {
    const html = rewriteShellHtml(
      buildShellHtml(),
      buildPreview({location: undefined, description: undefined}),
      pageUrl,
    );

    expect(getMetaContent(html, OG_DESCRIPTION_TAG)).toBe(
      'Aug 14, 9:00 PM – Aug 15, 2:00 AM',
    );
  });

  it('truncates a long og:description to ~200 characters', () => {
    const longDescription = 'x'.repeat(400);
    const html = rewriteShellHtml(
      buildShellHtml(),
      buildPreview({description: longDescription}),
      pageUrl,
    );

    const content = getMetaContent(html, OG_DESCRIPTION_TAG);
    expect(content).not.toBeNull();
    expect(content?.length).toBeLessThanOrEqual(200);
    expect(content).toContain('…');
  });
});

describe('applyEventPreview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rewrites the shell and preserves CSP/nosniff headers while dropping stale Content-Length/ETag', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(buildPreview()), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }),
    );

    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = buildAssetResponse(buildShellHtml());

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [fetchUrl] = fetchSpy.mock.calls[0] ?? [];
    expect(fetchUrl).toBe(
      'https://modest-impala-722.convex.site/api/events/abc123',
    );

    const html = await result.text();
    expect(html).toContain('<title>Warehouse Rager · Braket</title>');

    expect(result.headers.get('Content-Security-Policy')).toBe(
      CSP_HEADER_VALUE,
    );
    expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(result.headers.get('Content-Length')).toBeNull();
    expect(result.headers.get('ETag')).toBeNull();
  });

  it('returns the untouched shell for a non-event path without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/about');
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await result.text()).toBe(html);
    expect(result.headers.get('Content-Length')).not.toBeNull();
  });

  it('returns a non-HTML asset response untouched without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const body = '/* not html */';
    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = new Response(body, {
      status: 404,
      headers: {'Content-Type': 'text/plain; charset=utf-8'},
    });

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await result.text()).toBe(body);
    expect(result.status).toBe(404);
  });

  it('fails open when CONVEX_SITE_URL is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(
      request,
      buildEnv({CONVEX_SITE_URL: undefined}),
      assetResponse,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await result.text()).toBe(html);
  });

  it('fails open when CONVEX_SITE_URL is empty', async () => {
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(
      request,
      buildEnv({CONVEX_SITE_URL: ''}),
      assetResponse,
    );

    expect(await result.text()).toBe(html);
  });

  it('fails open when the fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(await result.text()).toBe(html);
    expect(result.headers.get('Content-Length')).not.toBeNull();
  });

  it('fails open when the fetch times out (AbortSignal.timeout)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new DOMException('The operation was aborted.', 'TimeoutError'),
    );
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(await result.text()).toBe(html);
  });

  it('fails open on a 404 from the preview endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not found', {status: 404}),
    );
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(await result.text()).toBe(html);
  });

  it('fails open on a 500 from the preview endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Server error', {status: 500}),
    );
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(await result.text()).toBe(html);
  });

  it('fails open on invalid JSON from the preview endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not json', {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }),
    );
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(await result.text()).toBe(html);
  });

  it('fails open when the payload is missing required fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({title: 'Missing dateLabel'}), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
      }),
    );
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/events/abc123');
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(await result.text()).toBe(html);
  });

  it('fails open for a non-GET request without fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const html = buildShellHtml();
    const request = new Request('https://community.braket.gay/events/abc123', {
      method: 'POST',
    });
    const assetResponse = buildAssetResponse(html);

    const result = await applyEventPreview(request, buildEnv(), assetResponse);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await result.text()).toBe(html);
  });
});
