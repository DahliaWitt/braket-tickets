import { proxyPostHogRequest } from './proxy';

interface PagesRequestContext {
  request: Request;
}

export async function onRequest(context: PagesRequestContext): Promise<Response> {
  return proxyPostHogRequest(context.request);
}
