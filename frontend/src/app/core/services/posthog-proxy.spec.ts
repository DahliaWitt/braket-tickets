import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyPostHogRequest, toPostHogUrl } from '../../../../functions/ingest/proxy';

function expectStringBody(body: BodyInit | null | undefined): string {
  if (typeof body !== 'string') {
    throw new Error('Expected proxied request body to be a string');
  }

  return body;
}

describe('PostHog proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('routes ingest traffic to the PostHog API host', () => {
    const upstreamUrl = toPostHogUrl('https://community.braket.gay/ingest/e/?ip=1');

    expect(upstreamUrl.toString()).toBe('https://us.i.posthog.com/e/?ip=1');
  });

  it('routes static dependency traffic to the PostHog asset host', () => {
    const upstreamUrl = toPostHogUrl('https://community.braket.gay/ingest/static/array.js?v=1');

    expect(upstreamUrl.toString()).toBe('https://us-assets.i.posthog.com/static/array.js?v=1');
  });

  it('routes remote config traffic to the PostHog asset host', () => {
    const upstreamUrl = toPostHogUrl(
      'https://community.braket.gay/ingest/array/project-token/config.js?v=1',
    );

    expect(upstreamUrl.toString()).toBe(
      'https://us-assets.i.posthog.com/array/project-token/config.js?v=1',
    );
  });

  it('forwards requests with the upstream host header, strips cookies, and omits x-forwarded-for', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const request = new Request('https://community.braket.gay/ingest/e/', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '203.0.113.42',
        cookie: 'session=secret',
        'true-client-ip': '203.0.113.42',
        'x-real-ip': '203.0.113.42',
        'x-braket-test': 'present',
      },
      body: JSON.stringify({ event: 'ticket_purchased' }),
    });

    await proxyPostHogRequest(request);

    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe('https://us.i.posthog.com/e/');
    expect(init?.method).toBe('POST');
    expect(headers.get('host')).toBe('us.i.posthog.com');
    expect(headers.has('cf-connecting-ip')).toBe(false);
    expect(headers.has('true-client-ip')).toBe(false);
    expect(headers.has('x-real-ip')).toBe(false);
    expect(headers.has('x-forwarded-for')).toBe(false);
    expect(headers.get('x-braket-test')).toBe('present');
    expect(headers.has('cookie')).toBe(false);
  });

  it('attaches Cloudflare location properties to JSON event payloads', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const request = new Request('https://community.braket.gay/ingest/e/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        event: 'ticket_purchased',
        properties: { existing: true },
      }),
    });

    Object.defineProperty(request, 'cf', {
      value: { metroCode: '807', country: 'US', regionCode: 'CA' },
      configurable: true,
    });

    await proxyPostHogRequest(request);

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const payload = JSON.parse(expectStringBody(init?.body)) as {
      properties: Record<string, unknown>;
    };

    expect(payload.properties).toMatchObject({
      existing: true,
      metro_code: '807',
      country_code: 'US',
      region_code: 'CA',
    });
  });

  it('omits missing Cloudflare location properties from JSON event payloads', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const request = new Request('https://community.braket.gay/ingest/e/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        event: 'pageview',
        properties: {},
      }),
    });

    await proxyPostHogRequest(request);

    const [, init] = fetchSpy.mock.calls[0] ?? [];
    const payload = JSON.parse(expectStringBody(init?.body)) as {
      properties: Record<string, unknown>;
    };

    expect(payload.properties.metro_code).toBeUndefined();
    expect(payload.properties.country_code).toBeUndefined();
    expect(payload.properties.region_code).toBeUndefined();
  });

  it('serves cached asset responses without fetching upstream again', async () => {
    const match = vi.fn().mockResolvedValue(new Response('cached asset'));
    const put = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('upstream asset'));
    vi.stubGlobal('caches', {
      default: {
        match,
        put,
      },
    });

    const response = await proxyPostHogRequest(
      new Request('https://community.braket.gay/ingest/static/array.js?v=1'),
    );

    expect(await response.text()).toBe('cached asset');
    expect(match).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('stores fetched asset responses in the cache', async () => {
    const match = vi.fn().mockResolvedValue(undefined);
    const put = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('fresh asset'));
    vi.stubGlobal('caches', {
      default: {
        match,
        put,
      },
    });

    const response = await proxyPostHogRequest(
      new Request('https://community.braket.gay/ingest/array/project-token/config.js?v=1'),
    );

    expect(await response.text()).toBe('fresh asset');
    expect(match).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
  });
});
