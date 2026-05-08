/**
 * Structured logger for Convex backend with PII scrubbing.
 *
 * Server-side equivalent of frontend/src/app/utils/logger.ts.
 * Uses plain console methods with structured prefixes that the
 * convex-log-forwarder can parse when streaming to Sentry.
 *
 * Usage:
 *   import { logger } from './lib/logger';
 *   logger.info('payments', 'Processing purchase', { orderId });
 *   logger.error('stripe', 'Webhook failed', error);
 *
 * Contextual logger (with request tracing):
 *   const log = logger.withContext({ requestId: 'abc123', sentryTraceId: 'def456' });
 *   log.info('http', 'Request received');
 *   // => [INFO][http][req:abc123][trace:def456] Request received
 */

import {sanitize} from '@shared/log-sanitizer';

export {sanitize} from '@shared/log-sanitizer';

function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((a) => sanitize(a));
}

export interface ContextualLogger {
  debug(module: string, message: string, ...args: unknown[]): void;
  info(module: string, message: string, ...args: unknown[]): void;
  warn(module: string, message: string, ...args: unknown[]): void;
  error(module: string, message: string, ...args: unknown[]): void;
  withContext(ctx: {
    requestId: string;
    sentryTraceId?: string;
  }): ContextualLogger;
}

function buildPrefix(
  level: string,
  module: string,
  requestId?: string,
  sentryTraceId?: string,
): string {
  let prefix = `[${level}][${module}]`;
  if (requestId) prefix += `[req:${requestId}]`;
  if (sentryTraceId) prefix += `[trace:${sentryTraceId}]`;
  return prefix;
}

export const logger: ContextualLogger = {
  debug(module: string, message: string, ...args: unknown[]) {
    console.log(
      `${buildPrefix('DEBUG', module)} ${sanitize(message)}`,
      ...sanitizeArgs(args),
    );
  },

  info(module: string, message: string, ...args: unknown[]) {
    console.info(
      `${buildPrefix('INFO', module)} ${sanitize(message)}`,
      ...sanitizeArgs(args),
    );
  },

  warn(module: string, message: string, ...args: unknown[]) {
    console.warn(
      `${buildPrefix('WARN', module)} ${sanitize(message)}`,
      ...sanitizeArgs(args),
    );
  },

  error(module: string, message: string, ...args: unknown[]) {
    console.error(
      `${buildPrefix('ERROR', module)} ${sanitize(message)}`,
      ...sanitizeArgs(args),
    );
  },

  withContext(ctx: {
    requestId: string;
    sentryTraceId?: string;
  }): ContextualLogger {
    const {requestId, sentryTraceId} = ctx;
    return {
      debug(module: string, message: string, ...args: unknown[]) {
        console.log(
          `${buildPrefix('DEBUG', module, requestId, sentryTraceId)} ${sanitize(message)}`,
          ...sanitizeArgs(args),
        );
      },

      info(module: string, message: string, ...args: unknown[]) {
        console.info(
          `${buildPrefix('INFO', module, requestId, sentryTraceId)} ${sanitize(message)}`,
          ...sanitizeArgs(args),
        );
      },

      warn(module: string, message: string, ...args: unknown[]) {
        console.warn(
          `${buildPrefix('WARN', module, requestId, sentryTraceId)} ${sanitize(message)}`,
          ...sanitizeArgs(args),
        );
      },

      error(module: string, message: string, ...args: unknown[]) {
        console.error(
          `${buildPrefix('ERROR', module, requestId, sentryTraceId)} ${sanitize(message)}`,
          ...sanitizeArgs(args),
        );
      },

      withContext(innerCtx: {
        requestId: string;
        sentryTraceId?: string;
      }): ContextualLogger {
        return logger.withContext(innerCtx);
      },
    };
  },
};
