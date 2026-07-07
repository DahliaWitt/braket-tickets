/**
 * Distributed tracing utilities for Convex HTTP actions.
 *
 * Provides request ID generation, trace context propagation, and a
 * `tracedHttpAction` wrapper that adds structured logging and response
 * headers for correlation with external tracing systems (e.g. Sentry).
 *
 * Log format: [LEVEL][module][req:REQUEST_ID] message
 * With sentry trace: [LEVEL][module][req:REQUEST_ID][trace:SENTRY_TRACE_ID] message
 *
 * Usage:
 *   import { tracedHttpAction } from './lib/tracing';
 *
 *   http.route({
 *     path: '/api/example',
 *     method: 'GET',
 *     handler: tracedHttpAction(async (ctx, request, trace) => {
 *       trace.log.info('example', 'Handling request');
 *       return new Response('ok', { status: 200 });
 *     }),
 *   });
 */

import {httpAction} from '../_generated/server';
import {logger, type ContextualLogger} from './logger';
import {getRequestMetadataSafe} from './request_metadata';

/**
 * Context object passed to traced HTTP action handlers.
 * Carries the generated request ID, optional Sentry trace header,
 * the request start time, and a contextual logger pre-seeded with
 * the request ID and trace ID.
 */
export interface TracingContext {
  /** Unique identifier for this request, sourced from X-Request-ID or generated. */
  requestId: string;
  /**
   * Convex's platform request ID (ctx.meta.getRequestMetadata), matching the
   * ID shown in the Convex dashboard/logs for this execution. Undefined on
   * runtimes without request metadata support.
   */
  convexRequestId: string | undefined;
  /** Sentry trace ID extracted from the sentry-trace header, if present. */
  sentryTraceId: string | undefined;
  /** Timestamp (ms since epoch) when the request was received. */
  startTime: number;
  /** Contextual logger with requestId (and optionally sentryTraceId) baked in. */
  log: ContextualLogger;
}

/**
 * Generate a unique request ID.
 *
 * Prefers the Web Crypto API's `randomUUID()` which is available in the
 * Convex runtime. Falls back to a timestamp + random hex string if the
 * API is unavailable (e.g. test environments).
 */
function generateRequestId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  // Fallback: timestamp (base-36) + random hex block
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 10);
  return `${ts}-${rand}`;
}

/**
 * Extract trace context from incoming HTTP request headers.
 *
 * Reads:
 *   - X-Request-ID  — caller-supplied request correlation ID
 *   - sentry-trace  — Sentry distributed trace header
 *   - baggage       — W3C trace context baggage (stored for future use)
 */
function extractTraceHeaders(request: Request): {
  incomingRequestId: string | null;
  sentryTraceId: string | null;
} {
  const incomingRequestId =
    request.headers.get('x-request-id') ?? request.headers.get('X-Request-ID');

  // The sentry-trace header format is: TRACE_ID-SPAN_ID[-SAMPLED]
  // We store the raw header value; consumers can parse it as needed.
  const sentryTraceId =
    request.headers.get('sentry-trace') ?? request.headers.get('Sentry-Trace');

  return {incomingRequestId, sentryTraceId};
}

/**
 * The handler type for a traced HTTP action.
 *
 * Identical to a standard `httpAction` handler except it receives a
 * third `trace: TracingContext` argument.
 */
type TracedHandler = (
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
  trace: TracingContext,
) => Promise<Response>;

/**
 * Wrap a handler with request tracing.
 *
 * - Extracts or generates a request ID
 * - Extracts the sentry-trace header if present
 * - Logs request start and end with method, URL path, status, and duration
 * - Adds X-Request-ID and X-Trace-Id headers to the response
 * - Passes a pre-seeded contextual logger via `trace.log`
 *
 * @example
 * ```ts
 * http.route({
 *   path: '/api/communities',
 *   method: 'GET',
 *   handler: tracedHttpAction(async (ctx, request, trace) => {
 *     trace.log.info('communities', 'Listing public communities');
 *     const data = await ctx.runQuery(internal.communities.directory.listPublicDirectoryInternal, {});
 *     return new Response(JSON.stringify(data), { status: 200 });
 *   }),
 * });
 * ```
 */
export function tracedHttpAction(
  handler: TracedHandler,
): ReturnType<typeof httpAction> {
  return httpAction(async (ctx, request) => {
    const startTime = Date.now();
    const {incomingRequestId, sentryTraceId} = extractTraceHeaders(request);
    const requestId = incomingRequestId ?? generateRequestId();
    const {requestId: convexRequestId} = await getRequestMetadataSafe(ctx);

    const log = logger.withContext({
      requestId,
      sentryTraceId: sentryTraceId ?? undefined,
    });

    const url = new URL(request.url);
    // One correlation line per request: every later Convex log line for this
    // execution carries the convex request ID in the dashboard, so this links
    // app-level request IDs (and Sentry traces) to Convex's own logs.
    log.info(
      'http',
      `→ ${request.method} ${url.pathname}` +
        (convexRequestId ? ` (convex-req: ${convexRequestId})` : ''),
    );

    const trace: TracingContext = {
      requestId,
      convexRequestId: convexRequestId ?? undefined,
      sentryTraceId: sentryTraceId ?? undefined,
      startTime,
      log,
    };

    let response: Response;
    try {
      response = await handler(ctx, request, trace);
    } catch (err) {
      const duration = Date.now() - startTime;
      log.error(
        'http',
        `✗ ${request.method} ${url.pathname} — unhandled error after ${duration}ms`,
        err,
      );
      throw err;
    }

    const duration = Date.now() - startTime;
    log.info(
      'http',
      `← ${request.method} ${url.pathname} ${response.status} (${duration}ms)`,
    );

    // Clone and augment headers so we don't mutate the original Response.
    const headers = new Headers(response.headers);
    headers.set('X-Request-ID', requestId);
    if (convexRequestId) {
      headers.set('X-Convex-Request-Id', convexRequestId);
    }
    if (sentryTraceId) {
      headers.set('X-Trace-Id', sentryTraceId);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}
