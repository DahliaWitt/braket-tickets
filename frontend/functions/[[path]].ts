import {handleAssetRequest, type PagesRequestContext} from './asset-miss';
import {applyEventPreview} from './og-preview';

export async function onRequest(
  context: PagesRequestContext,
): Promise<Response> {
  const assetResponse = await handleAssetRequest(context);
  return applyEventPreview(context.request, context.env, assetResponse);
}
