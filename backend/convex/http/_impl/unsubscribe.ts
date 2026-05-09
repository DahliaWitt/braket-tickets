import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import {getWriteCorsHeaders, type HttpEnvironmentConfig} from './config';
import {
  parseUnsubscribeAllBody,
  parseUnsubscribeToggleBody,
} from './request_parsing';
import {isPublicEndpointRateLimited} from './rate_limits';

function jsonBodyResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function redirectUnsubscribe(
  config: HttpEnvironmentConfig,
  query: string,
): Response {
  return Response.redirect(`${config.emailSiteUrl}/unsubscribe?${query}`, 302);
}

export function createUnsubscribeHandlers(config: HttpEnvironmentConfig): {
  handleUnsubscribeGet: (ctx: ActionCtx, request: Request) => Promise<Response>;
  handleUnsubscribeToggleOptions: (
    _ctx: ActionCtx,
    request: Request,
  ) => Promise<Response>;
  handleUnsubscribeAllOptions: (
    _ctx: ActionCtx,
    request: Request,
  ) => Promise<Response>;
  handleUnsubscribePreferencesGet: (
    ctx: ActionCtx,
    request: Request,
  ) => Promise<Response>;
  handleUnsubscribeTogglePost: (
    ctx: ActionCtx,
    request: Request,
  ) => Promise<Response>;
  handleUnsubscribeAllPost: (
    ctx: ActionCtx,
    request: Request,
  ) => Promise<Response>;
} {
  return {
    handleUnsubscribeGet: async (ctx, request) => {
      const url = new URL(request.url);
      const token = url.searchParams.get('token');

      if (!token) {
        return redirectUnsubscribe(config, 'error=invalid');
      }

      if (
        await isPublicEndpointRateLimited(ctx, request, 'unsubscribeEndpoint')
      ) {
        return redirectUnsubscribe(config, 'error=rate_limited');
      }

      try {
        await ctx.runMutation(internal.marketing.emails.unsubscribeByToken, {
          token,
        });
        return redirectUnsubscribe(
          config,
          `token=${encodeURIComponent(token)}&done=true`,
        );
      } catch {
        return redirectUnsubscribe(config, 'error=invalid');
      }
    },

    handleUnsubscribeToggleOptions: async (_ctx, request) => {
      const origin = request.headers.get('origin');
      return new Response(null, {
        status: 204,
        headers: {
          ...getWriteCorsHeaders(origin, config),
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    },

    handleUnsubscribeAllOptions: async (_ctx, request) => {
      const origin = request.headers.get('origin');
      return new Response(null, {
        status: 204,
        headers: {
          ...getWriteCorsHeaders(origin, config),
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    },

    handleUnsubscribePreferencesGet: async (ctx, request) => {
      const url = new URL(request.url);
      const token = url.searchParams.get('token');
      const corsHeaders = getWriteCorsHeaders(
        request.headers.get('origin'),
        config,
      );

      if (!token) {
        return jsonBodyResponse({error: 'missing_token'}, 400, corsHeaders);
      }

      if (
        await isPublicEndpointRateLimited(ctx, request, 'unsubscribeEndpoint')
      ) {
        return jsonBodyResponse({error: 'rate_limited'}, 429, {
          ...corsHeaders,
          'Retry-After': '60',
          'Cache-Control': 'no-store',
        });
      }

      const result = await ctx.runQuery(
        internal.marketing.emails.getPreferencesByToken,
        {
          token,
        },
      );

      if (!result) {
        return jsonBodyResponse({error: 'invalid_token'}, 404, corsHeaders);
      }

      return jsonBodyResponse(result, 200, corsHeaders);
    },

    handleUnsubscribeTogglePost: async (ctx, request) => {
      const corsHeaders = getWriteCorsHeaders(
        request.headers.get('origin'),
        config,
      );
      if (
        await isPublicEndpointRateLimited(ctx, request, 'unsubscribeEndpoint')
      ) {
        return jsonBodyResponse({error: 'rate_limited'}, 429, {
          ...corsHeaders,
          'Retry-After': '60',
          'Cache-Control': 'no-store',
        });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonBodyResponse({error: 'invalid_json'}, 400, corsHeaders);
      }

      const parsedBody = parseUnsubscribeToggleBody(body);
      if (!parsedBody) {
        return jsonBodyResponse({error: 'invalid_body'}, 400, corsHeaders);
      }

      try {
        await ctx.runMutation(
          internal.marketing.emails.toggleByToken,
          parsedBody,
        );
        return jsonBodyResponse({ok: true}, 200, corsHeaders);
      } catch {
        return jsonBodyResponse({error: 'invalid_token'}, 404, corsHeaders);
      }
    },

    handleUnsubscribeAllPost: async (ctx, request) => {
      const corsHeaders = getWriteCorsHeaders(
        request.headers.get('origin'),
        config,
      );
      if (
        await isPublicEndpointRateLimited(ctx, request, 'unsubscribeEndpoint')
      ) {
        return jsonBodyResponse({error: 'rate_limited'}, 429, {
          ...corsHeaders,
          'Retry-After': '60',
          'Cache-Control': 'no-store',
        });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return jsonBodyResponse({error: 'invalid_json'}, 400, corsHeaders);
      }

      const parsedBody = parseUnsubscribeAllBody(body);
      if (!parsedBody) {
        return jsonBodyResponse({error: 'invalid_body'}, 400, corsHeaders);
      }

      try {
        await ctx.runMutation(
          internal.marketing.emails.unsubscribeAllByToken,
          parsedBody,
        );
        return jsonBodyResponse({ok: true}, 200, corsHeaders);
      } catch {
        return jsonBodyResponse({error: 'invalid_token'}, 404, corsHeaders);
      }
    },
  };
}
