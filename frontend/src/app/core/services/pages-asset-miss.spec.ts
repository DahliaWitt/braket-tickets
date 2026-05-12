import {describe, expect, it, vi} from 'vitest';
import {
  handleAssetRequest,
  isGuardedAssetPath,
  isSpaShellFallback,
} from '../../../../functions/asset-miss';

function createContext(url: string, response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);

  return {
    context: {
      request: new Request(url),
      env: {
        ASSETS: {fetch},
      },
    },
    fetch,
  };
}

describe('Pages asset miss guard', () => {
  it('guards root JavaScript and CSS bundle paths', () => {
    expect(isGuardedAssetPath('/chunk-OLD.js')).toBe(true);
    expect(isGuardedAssetPath('/styles-OLD.css')).toBe(true);
  });

  it('does not treat extensionless app routes as assets', () => {
    expect(isGuardedAssetPath('/unknown-app-route')).toBe(false);
    expect(isGuardedAssetPath('/events/k577gn69e6a046g678zbry01t5869n8m')).toBe(
      false,
    );
  });

  it('recognizes HTML responses as SPA shell fallbacks', () => {
    expect(
      isSpaShellFallback(
        new Response('<!doctype html>', {
          headers: {'content-type': 'text/html; charset=utf-8'},
        }),
      ),
    ).toBe(true);
  });

  it('returns 404 when a guarded asset resolves to the SPA shell', async () => {
    const {context} = createContext(
      'https://community.braket.gay/chunk-OLD.js',
      new Response('<!doctype html>', {
        headers: {'content-type': 'text/html; charset=utf-8'},
      }),
    );

    const response = await handleAssetRequest(context);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe(
      'text/plain; charset=utf-8',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('passes through existing JavaScript assets', async () => {
    const asset = new Response('console.log("ok");', {
      headers: {'content-type': 'application/javascript'},
    });
    const {context} = createContext(
      'https://community.braket.gay/main-OK.js',
      asset,
    );

    await expect(handleAssetRequest(context)).resolves.toBe(asset);
  });

  it('passes extensionless app routes to the asset binding unchanged', async () => {
    const shell = new Response('<!doctype html>', {
      headers: {'content-type': 'text/html; charset=utf-8'},
    });
    const {context, fetch} = createContext(
      'https://community.braket.gay/unknown-app-route',
      shell,
    );

    await expect(handleAssetRequest(context)).resolves.toBe(shell);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
