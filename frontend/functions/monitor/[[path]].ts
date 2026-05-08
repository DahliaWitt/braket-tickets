import { proxySentryTunnelRequest } from './proxy';

interface PagesRequestContext {
  request: Request;
}

export async function onRequest(context: PagesRequestContext): Promise<Response> {
  return proxySentryTunnelRequest(context.request);
}
