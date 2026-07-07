/**
 * @vitest-environment node
 */
import {describe, it, expect, vi, beforeEach} from 'vitest';

// Mock httpAction so tracedHttpAction can be called in tests without a real
// Convex runtime. The mock passes the handler straight through.
vi.mock('../_generated/server', () => ({
  httpAction: vi.fn(
    (handler: (ctx: unknown, req: Request) => Promise<Response>) => handler,
  ),
}));

// Mock the logger module so we can assert log calls and suppress console output
// in tracedHttpAction tests. The logger.withContext describe block below
// re-imports the real implementation via vi.importActual.
const mockLog = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  withContext: vi.fn(),
};

vi.mock('./logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    withContext: vi.fn(),
  },
  sanitize: (v: unknown) => v,
}));

import {tracedHttpAction} from './tracing';
import {logger} from './logger';

const mockedLogger = vi.mocked(logger);

// Build a fake Request for use in tests.
function makeRequest(
  url: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Request {
  return new Request(url, {method, headers});
}

// Minimal ctx stub — tracedHttpAction only passes it through to the inner handler.
const stubCtx = {} as Parameters<Parameters<typeof tracedHttpAction>[0]>[0];

// Helper to invoke the wrapped handler (the mock returns the handler directly).
function invoke(
  wrapped: ReturnType<typeof tracedHttpAction>,
  request: Request,
): Promise<Response> {
  return (
    wrapped as unknown as (ctx: unknown, req: Request) => Promise<Response>
  )(stubCtx, request);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: withContext returns our controllable mockLog.
  mockedLogger.withContext.mockReturnValue(mockLog);
  mockLog.withContext.mockReturnValue(mockLog);
});

// ---------------------------------------------------------------------------
// tracedHttpAction — X-Request-ID handling
// ---------------------------------------------------------------------------

describe('tracedHttpAction — X-Request-ID header', () => {
  it('adds X-Request-ID to response when no incoming header', async () => {
    const handler = tracedHttpAction(
      async () => new Response('ok', {status: 200}),
    );
    const response = await invoke(
      handler,
      makeRequest('https://example.com/api/test'),
    );

    const xRequestId = response.headers.get('X-Request-ID');
    expect(xRequestId).toBeTruthy();
    expect(typeof xRequestId).toBe('string');
  });

  it('uses incoming X-Request-ID when provided', async () => {
    const incomingId = 'my-trace-abc-123';
    const handler = tracedHttpAction(
      async () => new Response('ok', {status: 200}),
    );
    const response = await invoke(
      handler,
      makeRequest('https://example.com/api/test', {'X-Request-ID': incomingId}),
    );

    expect(response.headers.get('X-Request-ID')).toBe(incomingId);
  });

  it('propagates incoming X-Request-ID via lowercase x-request-id', async () => {
    const incomingId = 'lower-case-id-999';
    const handler = tracedHttpAction(
      async () => new Response('ok', {status: 200}),
    );
    const response = await invoke(
      handler,
      makeRequest('https://example.com/api/test', {'x-request-id': incomingId}),
    );

    expect(response.headers.get('X-Request-ID')).toBe(incomingId);
  });

  it('passes requestId to the inner handler via trace context', async () => {
    const incomingId = 'handler-sees-this';
    let capturedRequestId: string | undefined;

    const handler = tracedHttpAction(async (_ctx, _req, trace) => {
      capturedRequestId = trace.requestId;
      return new Response('ok', {status: 200});
    });

    await invoke(
      handler,
      makeRequest('https://example.com/api/test', {'X-Request-ID': incomingId}),
    );

    expect(capturedRequestId).toBe(incomingId);
  });

  it('generates a non-empty requestId when no incoming header', async () => {
    let capturedRequestId: string | undefined;

    const handler = tracedHttpAction(async (_ctx, _req, trace) => {
      capturedRequestId = trace.requestId;
      return new Response('ok', {status: 200});
    });

    await invoke(handler, makeRequest('https://example.com/api/test'));

    expect(capturedRequestId).toBeTruthy();
    expect(typeof capturedRequestId).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// tracedHttpAction — sentry-trace header handling
// ---------------------------------------------------------------------------

describe('tracedHttpAction — sentry-trace header', () => {
  it('sets X-Trace-Id in response when sentry-trace header is present', async () => {
    const sentryTrace = 'abc123def456-span01-1';
    const handler = tracedHttpAction(
      async () => new Response('ok', {status: 200}),
    );
    const response = await invoke(
      handler,
      makeRequest('https://example.com/api/test', {
        'sentry-trace': sentryTrace,
      }),
    );

    expect(response.headers.get('X-Trace-Id')).toBe(sentryTrace);
  });

  it('does not set X-Trace-Id when sentry-trace header is absent', async () => {
    const handler = tracedHttpAction(
      async () => new Response('ok', {status: 200}),
    );
    const response = await invoke(
      handler,
      makeRequest('https://example.com/api/test'),
    );

    expect(response.headers.get('X-Trace-Id')).toBeNull();
  });

  it('passes sentryTraceId to the inner handler via trace context', async () => {
    const sentryTrace = 'trace-id-for-handler';
    let capturedSentryTrace: string | undefined;

    const handler = tracedHttpAction(async (_ctx, _req, trace) => {
      capturedSentryTrace = trace.sentryTraceId;
      return new Response('ok', {status: 200});
    });

    await invoke(
      handler,
      makeRequest('https://example.com/api/test', {
        'sentry-trace': sentryTrace,
      }),
    );

    expect(capturedSentryTrace).toBe(sentryTrace);
  });

  it('sets sentryTraceId to undefined in trace context when header absent', async () => {
    let capturedSentryTrace: string | undefined = 'should-be-overwritten';

    const handler = tracedHttpAction(async (_ctx, _req, trace) => {
      capturedSentryTrace = trace.sentryTraceId;
      return new Response('ok', {status: 200});
    });

    await invoke(handler, makeRequest('https://example.com/api/test'));

    expect(capturedSentryTrace).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tracedHttpAction — logging
// ---------------------------------------------------------------------------

describe('tracedHttpAction — logging', () => {
  it('logs request start with → prefix', async () => {
    const handler = tracedHttpAction(
      async () => new Response('ok', {status: 200}),
    );
    await invoke(handler, makeRequest('https://example.com/api/things'));

    expect(mockLog.info).toHaveBeenCalledWith(
      'http',
      expect.stringContaining('→ GET /api/things'),
    );
  });

  it('logs request end with ← prefix, status code, and duration', async () => {
    const handler = tracedHttpAction(
      async () => new Response('created', {status: 201}),
    );
    await invoke(
      handler,
      makeRequest('https://example.com/api/things', {}, 'POST'),
    );

    const endLogCall = mockLog.info.mock.calls.find(
      (args: unknown[]) =>
        typeof args[1] === 'string' && args[1].startsWith('←'),
    );
    expect(endLogCall).toBeDefined();
    const endMsg = endLogCall![1] as string;
    expect(endMsg).toContain('POST /api/things');
    expect(endMsg).toContain('201');
    expect(endMsg).toMatch(/\d+ms/);
  });

  it('calls logger.withContext with the requestId', async () => {
    const incomingId = 'ctx-check-id';
    const handler = tracedHttpAction(
      async () => new Response('ok', {status: 200}),
    );
    await invoke(
      handler,
      makeRequest('https://example.com/api/test', {'X-Request-ID': incomingId}),
    );

    expect(mockedLogger.withContext).toHaveBeenCalledWith(
      expect.objectContaining({requestId: incomingId}),
    );
  });

  it('calls logger.withContext with sentryTraceId when present', async () => {
    const sentryTrace = 'sentry-for-context';
    const handler = tracedHttpAction(
      async () => new Response('ok', {status: 200}),
    );
    await invoke(
      handler,
      makeRequest('https://example.com/api/test', {
        'sentry-trace': sentryTrace,
      }),
    );

    expect(mockedLogger.withContext).toHaveBeenCalledWith(
      expect.objectContaining({sentryTraceId: sentryTrace}),
    );
  });

  it('logs unhandled errors with ✗ prefix and re-throws', async () => {
    const boom = new Error('something exploded');
    const handler = tracedHttpAction(async () => {
      throw boom;
    });

    await expect(
      invoke(handler, makeRequest('https://example.com/api/explode')),
    ).rejects.toThrow('something exploded');

    expect(mockLog.error).toHaveBeenCalledWith(
      'http',
      expect.stringContaining('✗ GET /api/explode'),
      boom,
    );
  });

  it('includes duration in unhandled error log', async () => {
    const handler = tracedHttpAction(async () => {
      throw new Error('boom');
    });

    await expect(
      invoke(handler, makeRequest('https://example.com/api/explode')),
    ).rejects.toThrow();

    const [, errorMsg] = mockLog.error.mock.calls[0] as [string, string];
    expect(errorMsg).toMatch(/\d+ms/);
  });

  it('does not log end when handler throws', async () => {
    const handler = tracedHttpAction(async () => {
      throw new Error('fail');
    });

    await expect(
      invoke(handler, makeRequest('https://example.com/api/explode')),
    ).rejects.toThrow();

    const endLogCall = mockLog.info.mock.calls.find(
      (args: unknown[]) =>
        typeof args[1] === 'string' && args[1].startsWith('←'),
    );
    expect(endLogCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tracedHttpAction — response passthrough
// ---------------------------------------------------------------------------

describe('tracedHttpAction — response passthrough', () => {
  it('preserves the original response status code', async () => {
    const handler = tracedHttpAction(
      async () => new Response(JSON.stringify({ok: true}), {status: 202}),
    );
    const response = await invoke(
      handler,
      makeRequest('https://example.com/api/test'),
    );

    expect(response.status).toBe(202);
  });

  it('preserves existing response headers alongside tracing headers', async () => {
    const handler = tracedHttpAction(
      async () =>
        new Response('ok', {
          status: 200,
          headers: {'Content-Type': 'application/json'},
        }),
    );
    const response = await invoke(
      handler,
      makeRequest('https://example.com/api/test'),
    );

    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('X-Request-ID')).toBeTruthy();
  });

  it('passes startTime in trace context', async () => {
    const beforeMs = Date.now();
    let capturedStartTime: number | undefined;

    const handler = tracedHttpAction(async (_ctx, _req, trace) => {
      capturedStartTime = trace.startTime;
      return new Response('ok', {status: 200});
    });

    await invoke(handler, makeRequest('https://example.com/api/test'));

    expect(capturedStartTime).toBeGreaterThanOrEqual(beforeMs);
    expect(capturedStartTime).toBeLessThanOrEqual(Date.now());
  });
});

// ---------------------------------------------------------------------------
// logger.withContext — uses the real logger via vi.importActual
// ---------------------------------------------------------------------------

describe('logger.withContext', () => {
  // Pull the real (unmocked) logger for these tests.
  let realLogger: (typeof import('./logger'))['logger'];

  beforeEach(async () => {
    const mod = await vi.importActual<typeof import('./logger')>('./logger');
    realLogger = mod.logger;
  });

  it('creates a contextual logger that logs with requestId prefix', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const log = realLogger.withContext({requestId: 'req-abc'});
    log.info('payments', 'Processing order');

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[req:req-abc]'),
    );
    infoSpy.mockRestore();
  });

  it('creates a contextual logger that logs with sentryTraceId prefix', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const log = realLogger.withContext({
      requestId: 'req-xyz',
      sentryTraceId: 'sentry-999',
    });
    log.info('http', 'Handler called');

    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('[trace:sentry-999]'),
    );
    infoSpy.mockRestore();
  });

  it('omits trace segment when sentryTraceId is not provided', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const log = realLogger.withContext({requestId: 'req-noTrace'});
    log.info('http', 'No sentry');

    const calledWith = infoSpy.mock.calls[0][0] as string;
    expect(calledWith).not.toContain('[trace:');
    infoSpy.mockRestore();
  });

  it('includes module name in prefix', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const log = realLogger.withContext({requestId: 'req-mod'});
    log.info('stripe', 'Webhook received');

    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[stripe]'));
    infoSpy.mockRestore();
  });

  it('sanitizes PII in messages logged through contextual logger', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const log = realLogger.withContext({requestId: 'req-pii'});
    log.info('users', 'Contact is user@example.com');

    const calledWith = infoSpy.mock.calls[0][0] as string;
    expect(calledWith).not.toContain('user@example.com');
    expect(calledWith).toContain('[REDACTED]');
    infoSpy.mockRestore();
  });

  it('sanitizes sensitive fields in extra args', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = realLogger.withContext({requestId: 'req-sens'});
    log.error('auth', 'Auth failure', {token: 'super-secret', userId: '123'});

    // Second positional arg (after the prefix string) is the sanitized extra object.
    const extraArg = errorSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(extraArg).toEqual({token: '[REDACTED]', userId: '123'});
    errorSpy.mockRestore();
  });

  it('supports all four log levels', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const log = realLogger.withContext({requestId: 'req-levels'});
    log.debug('mod', 'debug msg');
    log.info('mod', 'info msg');
    log.warn('mod', 'warn msg');
    log.error('mod', 'error msg');

    expect(logSpy).toHaveBeenCalledOnce();
    expect(infoSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();

    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// tracedHttpAction — Convex platform request ID correlation
// ---------------------------------------------------------------------------

describe('tracedHttpAction — X-Convex-Request-Id header', () => {
  const ctxWithMeta = {
    meta: {
      getRequestMetadata: () =>
        Promise.resolve({
          ip: '127.0.0.1',
          userAgent: 'test',
          requestId: 'convex-req-123',
          scheduledFunctionId: null,
        }),
    },
  } as Parameters<Parameters<typeof tracedHttpAction>[0]>[0];

  function invokeWithMeta(
    wrapped: ReturnType<typeof tracedHttpAction>,
    request: Request,
  ): Promise<Response> {
    return (
      wrapped as unknown as (ctx: unknown, req: Request) => Promise<Response>
    )(ctxWithMeta, request);
  }

  it('sets X-Convex-Request-Id when the runtime provides request metadata', async () => {
    const wrapped = tracedHttpAction(async () => new Response('ok'));
    const response = await invokeWithMeta(
      wrapped,
      makeRequest('https://example.com/api/test'),
    );
    expect(response.headers.get('X-Convex-Request-Id')).toBe('convex-req-123');
  });

  it('passes convexRequestId to the inner handler via trace context', async () => {
    let seen: string | undefined;
    const wrapped = tracedHttpAction(async (_ctx, _req, trace) => {
      seen = trace.convexRequestId;
      return new Response('ok');
    });
    await invokeWithMeta(wrapped, makeRequest('https://example.com/api/test'));
    expect(seen).toBe('convex-req-123');
  });

  it('omits X-Convex-Request-Id when the runtime lacks request metadata', async () => {
    const wrapped = tracedHttpAction(async () => new Response('ok'));
    const response = await invoke(
      wrapped,
      makeRequest('https://example.com/api/test'),
    );
    expect(response.headers.get('X-Convex-Request-Id')).toBeNull();
  });
});
