import {isRecord} from '@shared/type-guards';

const INGEST_PREFIX = '/ingest';
const POSTHOG_API_HOST = 'https://us.i.posthog.com';
const POSTHOG_ASSET_HOST = 'https://us-assets.i.posthog.com';
const VISITOR_IP_HEADERS = [
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'true-client-ip',
  'x-forwarded-for',
  'x-real-ip',
] as const;

type CloudflareRequest = Request & {
  cf?: {
    metroCode?: string | null;
    country?: string | null;
    regionCode?: string | null;
  };
};

function isAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith(`${INGEST_PREFIX}/static/`) ||
    pathname.startsWith(`${INGEST_PREFIX}/array/`)
  );
}

function getUpstreamOrigin(pathname: string): string {
  return isAssetPath(pathname) ? POSTHOG_ASSET_HOST : POSTHOG_API_HOST;
}

function stripVisitorIpHeaders(headers: Headers): void {
  for (const headerName of VISITOR_IP_HEADERS) {
    headers.delete(headerName);
  }
}

export function toPostHogUrl(requestUrl: string | URL): URL {
  const url =
    typeof requestUrl === 'string'
      ? new URL(requestUrl)
      : new URL(requestUrl.toString());
  const strippedPath =
    url.pathname === INGEST_PREFIX
      ? '/'
      : url.pathname.slice(INGEST_PREFIX.length) || '/';
  const upstreamUrl = new URL(getUpstreamOrigin(url.pathname));

  upstreamUrl.pathname = strippedPath;
  upstreamUrl.search = url.search;

  return upstreamUrl;
}

function getLocationProperties(
  request: CloudflareRequest,
): Record<string, string> {
  const properties: Record<string, string> = {};

  if (request.cf?.metroCode) {
    properties.metro_code = request.cf.metroCode;
  }

  if (request.cf?.country) {
    properties.country_code = request.cf.country;
  }

  if (request.cf?.regionCode) {
    properties.region_code = request.cf.regionCode;
  }

  return properties;
}

function enrichEventProperties(
  event: unknown,
  locationProperties: Record<string, string>,
): Record<string, unknown> | unknown {
  if (!isRecord(event)) {
    return event;
  }

  const existingProperties = isRecord(event.properties) ? event.properties : {};

  return {
    ...event,
    properties: {
      ...existingProperties,
      ...locationProperties,
    },
  };
}

async function getRequestBody(
  request: CloudflareRequest,
): Promise<BodyInit | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  const contentType = request.headers.get('content-type') ?? '';

  if (!contentType.includes('application/json')) {
    return request.body ?? undefined;
  }

  const requestText = await request.text();
  const locationProperties = getLocationProperties(request);

  if (Object.keys(locationProperties).length === 0) {
    return requestText;
  }

  try {
    const payload = JSON.parse(requestText) as unknown;

    if (Array.isArray(payload)) {
      return JSON.stringify(
        payload.map((event) =>
          enrichEventProperties(event, locationProperties),
        ),
      );
    }

    return JSON.stringify(enrichEventProperties(payload, locationProperties));
  } catch {
    return requestText;
  }
}

export async function proxyPostHogRequest(request: Request): Promise<Response> {
  const cloudflareRequest = request as CloudflareRequest;
  const upstreamUrl = toPostHogUrl(request.url);
  const headers = new Headers(request.headers);
  const requestUrl = new URL(request.url);
  // Cloudflare Workers extends CacheStorage with a `default` Cache; cast since DOM lib types don't include it.
  const cfCaches = globalThis.caches as unknown as
    | {default?: Cache}
    | undefined;
  const cache = isAssetPath(requestUrl.pathname)
    ? cfCaches?.default
    : undefined;

  if (cache) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  headers.set('host', upstreamUrl.host);
  headers.delete('content-length');
  headers.delete('cookie');
  stripVisitorIpHeaders(headers);

  const response = await fetch(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body: await getRequestBody(cloudflareRequest),
  });

  if (cache) {
    await cache.put(request, response.clone());
  }

  return response;
}
