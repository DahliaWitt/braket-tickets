import {internal} from '../../_generated/api';
import type {ActionCtx} from '../../_generated/server';
import {logger} from '../../lib/logger';
import type {HttpEnvironmentConfig} from './config';

const TRANSPARENT_GIF = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59,
]);

function transparentPixelResponse(): Response {
  return new Response(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Cache-Control':
        'private, no-store, no-cache, max-age=0, must-revalidate',
      'Content-Length': String(TRANSPARENT_GIF.byteLength),
      'Content-Type': 'image/gif',
      Expires: '0',
      Pragma: 'no-cache',
    },
  });
}

export function createMarketingTrackingHandlers(
  config: HttpEnvironmentConfig,
): {
  handleMarketingClickGet: (
    ctx: ActionCtx,
    request: Request,
  ) => Promise<Response>;
  handleMarketingOneClickGet: (
    ctx: ActionCtx,
    request: Request,
  ) => Promise<Response>;
  handleMarketingOneClickPost: (
    ctx: ActionCtx,
    request: Request,
  ) => Promise<Response>;
  handleMarketingOpenGet: (
    ctx: ActionCtx,
    request: Request,
  ) => Promise<Response>;
} {
  const handleMarketingOneClick = async (
    ctx: ActionCtx,
    request: Request,
  ): Promise<Response> => {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (token) {
      try {
        await ctx.runMutation(internal.marketing.emails.unsubscribeByToken, {
          token,
        });
      } catch (error: unknown) {
        // Return a generic success response to satisfy one-click clients.
        logger.warn('marketing', 'One-click unsubscribe failed', {error});
      }
    }

    return new Response('OK', {
      status: 200,
      headers: {
        'Cache-Control':
          'private, no-store, no-cache, max-age=0, must-revalidate',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });
  };

  return {
    handleMarketingOpenGet: async (ctx, request) => {
      const url = new URL(request.url);
      const token = url.searchParams.get('token');

      if (token) {
        try {
          await ctx.runMutation(internal.marketing.emails.recordDeliveryOpen, {
            token,
          });
        } catch (error: unknown) {
          // Do not leak token validity through the pixel response.
          logger.warn('marketing', 'Open-tracking mutation failed', {error});
        }
      }

      return transparentPixelResponse();
    },

    handleMarketingClickGet: async (ctx, request) => {
      const url = new URL(request.url);
      const token = url.searchParams.get('token');

      if (!token) {
        return Response.redirect(config.emailSiteUrl, 302);
      }

      try {
        const targetUrl = await ctx.runMutation(
          internal.marketing.emails.recordDeliveryClick,
          {
            token,
          },
        );
        if (targetUrl) {
          return Response.redirect(targetUrl, 302);
        }
      } catch (error: unknown) {
        // Fall through to the site root if the token is invalid.
        logger.warn('marketing', 'Click-tracking mutation failed', {error});
      }

      return Response.redirect(config.emailSiteUrl, 302);
    },

    handleMarketingOneClickGet: handleMarketingOneClick,
    handleMarketingOneClickPost: handleMarketingOneClick,
  };
}
