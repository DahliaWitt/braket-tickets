import {handleAssetRequest} from './asset-miss';

interface PagesAssetEnvironment {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

interface PagesRequestContext {
  request: Request;
  env: PagesAssetEnvironment;
}

export async function onRequest(
  context: PagesRequestContext,
): Promise<Response> {
  return handleAssetRequest(context);
}
