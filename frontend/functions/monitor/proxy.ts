const MONITOR_PREFIX = '/monitor';
const SENTRY_INGEST_HOST = 'o96755.ingest.us.sentry.io';
const VISITOR_IP_HEADERS = [
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'true-client-ip',
  'x-forwarded-for',
  'x-real-ip',
] as const;
const ALLOWED_SENTRY_PROJECT_IDS = new Set([
  // Production project
  '4510889653895168',
  // Preview project
  '4511146383376384',
]);

function getEnvelopeHeaderBytes(payload: Uint8Array): Uint8Array {
  const newlineIndex = payload.indexOf(0x0a);
  return newlineIndex === -1 ? payload : payload.slice(0, newlineIndex);
}

function stripVisitorIpHeaders(headers: Headers): void {
  for (const headerName of VISITOR_IP_HEADERS) {
    headers.delete(headerName);
  }
}

function parseDsn(payload: Uint8Array): URL | null {
  const headerBytes = getEnvelopeHeaderBytes(payload);
  const headerText = new TextDecoder().decode(headerBytes).trim();

  if (!headerText) {
    return null;
  }

  try {
    const header = JSON.parse(headerText) as { dsn?: unknown };
    if (typeof header.dsn !== 'string' || header.dsn === '') {
      return null;
    }

    return new URL(header.dsn);
  } catch {
    return null;
  }
}

export function toSentryEnvelopeUrl(requestBody: ArrayBuffer): URL | null {
  const dsn = parseDsn(new Uint8Array(requestBody));

  if (!dsn || dsn.protocol !== 'https:' || dsn.host !== SENTRY_INGEST_HOST) {
    return null;
  }

  const projectId = dsn.pathname.replace(/^\/+/, '');
  if (!/^\d+$/.test(projectId) || !ALLOWED_SENTRY_PROJECT_IDS.has(projectId)) {
    return null;
  }

  return new URL(`https://${dsn.host}/api/${projectId}/envelope/`);
}

export async function proxySentryTunnelRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: {
        Allow: 'POST',
      },
    });
  }

  const requestBody = await request.arrayBuffer();
  const upstreamUrl = toSentryEnvelopeUrl(requestBody);

  if (!upstreamUrl) {
    return new Response('Invalid Sentry envelope', { status: 400 });
  }

  const headers = new Headers(request.headers);

  headers.set('host', upstreamUrl.host);
  headers.delete('content-length');
  headers.delete('cookie');
  stripVisitorIpHeaders(headers);

  return fetch(upstreamUrl.toString(), {
    method: 'POST',
    headers,
    body: requestBody,
  });
}

export { ALLOWED_SENTRY_PROJECT_IDS, MONITOR_PREFIX, SENTRY_INGEST_HOST };
