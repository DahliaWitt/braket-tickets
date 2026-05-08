import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  proxySentryTunnelRequest,
  SENTRY_INGEST_HOST,
  toSentryEnvelopeUrl,
} from '../../../../functions/monitor/proxy';

function buildEnvelope(dsn: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`${JSON.stringify({ dsn })}\n{"type":"event"}\n{"message":"test"}`);
}

describe('Sentry tunnel proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes envelopes to the Sentry project envelope endpoint', () => {
    const body = buildEnvelope(
      `https://public@example.invalid@${SENTRY_INGEST_HOST}/4511146383376384`,
    ).buffer as ArrayBuffer;
    const upstreamUrl = toSentryEnvelopeUrl(body);

    expect(upstreamUrl?.toString()).toBe(
      `https://${SENTRY_INGEST_HOST}/api/4511146383376384/envelope/`,
    );
  });

  it('rejects envelopes for unknown hosts', () => {
    const body = buildEnvelope('https://public@example.ingest.sentry.io/123').buffer as ArrayBuffer;

    expect(toSentryEnvelopeUrl(body)).toBeNull();
  });

  it('rejects envelopes for unapproved project IDs', () => {
    const body = buildEnvelope(
      `https://public@example.invalid@${SENTRY_INGEST_HOST}/9999999999999999`,
    ).buffer as ArrayBuffer;

    expect(toSentryEnvelopeUrl(body)).toBeNull();
  });

  it('forwards requests with the upstream host header, strips cookies, and omits x-forwarded-for', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
    const body = buildEnvelope(
      `https://public@example.invalid@${SENTRY_INGEST_HOST}/4511146383376384`,
    );
    const request = new Request('https://community.braket.gay/monitor', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '203.0.113.42',
        cookie: 'session=secret',
        'content-type': 'application/x-sentry-envelope',
        'true-client-ip': '203.0.113.42',
        'x-real-ip': '203.0.113.42',
        'x-braket-test': 'present',
      },
      body: body as BodyInit,
    });

    await proxySentryTunnelRequest(request);

    expect(fetchSpy).toHaveBeenCalledOnce();

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    const headers = new Headers(init?.headers);

    expect(url).toBe(`https://${SENTRY_INGEST_HOST}/api/4511146383376384/envelope/`);
    expect(init?.method).toBe('POST');
    expect(headers.get('host')).toBe(SENTRY_INGEST_HOST);
    expect(headers.has('cf-connecting-ip')).toBe(false);
    expect(headers.has('true-client-ip')).toBe(false);
    expect(headers.has('x-real-ip')).toBe(false);
    expect(headers.has('x-forwarded-for')).toBe(false);
    expect(headers.get('x-braket-test')).toBe('present');
    expect(headers.get('content-type')).toBe('application/x-sentry-envelope');
    expect(headers.has('cookie')).toBe(false);
  });

  it('returns 400 for invalid envelopes', async () => {
    const response = await proxySentryTunnelRequest(
      new Request('https://community.braket.gay/monitor', {
        method: 'POST',
        body: 'not-a-valid-envelope',
      }),
    );

    expect(response.status).toBe(400);
  });

  it('returns 405 for non-post requests', async () => {
    const response = await proxySentryTunnelRequest(
      new Request('https://community.braket.gay/monitor', {
        method: 'GET',
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });
});
