interface PagesAssetEnvironment {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  /** Public Convex HTTP action base URL, e.g. https://foo.convex.site. */
  CONVEX_SITE_URL?: string;
}

interface PagesRequestContext {
  request: Request;
  env: PagesAssetEnvironment;
}

const GUARDED_ASSET_EXTENSIONS = new Set(['.js', '.css']);

function isGuardedAssetPath(pathname: string): boolean {
  for (const extension of GUARDED_ASSET_EXTENSIONS) {
    if (pathname.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

function isSpaShellFallback(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.toLowerCase().includes('text/html');
}

function notFoundResponse(): Response {
  return new Response('Not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function handleAssetRequest(
  context: PagesRequestContext,
): Promise<Response> {
  const url = new URL(context.request.url);

  if (!isGuardedAssetPath(url.pathname)) {
    return context.env.ASSETS.fetch(context.request);
  }

  const response = await context.env.ASSETS.fetch(context.request);
  if (isSpaShellFallback(response)) {
    return notFoundResponse();
  }

  return response;
}

export {isGuardedAssetPath, isSpaShellFallback};
export type {PagesAssetEnvironment, PagesRequestContext};
