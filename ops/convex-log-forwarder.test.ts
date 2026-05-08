import {describe, expect, it, vi} from 'vitest';

import {
  buildRuntimeConfig,
  createPostHogPayload,
  normalizeEvent,
  sendNormalizedEvent,
} from './convex-log-forwarder.mjs';

describe('convex-log-forwarder runtime config', () => {
  it('defaults to posthog and throws when PostHog token missing', () => {
    expect(() =>
      buildRuntimeConfig({
        CONVEX_LOG_TARGET: 'prod',
      }),
    ).toThrowError(
      /POSTHOG_LOGS_PROJECT_TOKEN is required when sink is posthog/i,
    );
  });

  it('accepts sink=none without provider credentials', () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'none',
    });

    expect(config.sink).toBe('none');
    expect(
      (config as Record<string, unknown>)['posthogProjectToken'],
    ).toBeUndefined();
    expect((config as Record<string, unknown>)['sentryDsn']).toBeUndefined();
  });

  it('throws when sink is sentry but SENTRY_DSN is missing', () => {
    expect(() =>
      buildRuntimeConfig({
        CONVEX_LOG_SINK: 'sentry',
      }),
    ).toThrowError(/SENTRY_DSN is required when sink is sentry/i);
  });
});

describe('convex-log-forwarder posthog payload', () => {
  it('maps request_id and function_name into otlp attributes for normalized events', () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'posthog',
      POSTHOG_LOGS_PROJECT_TOKEN: 'test-token',
    });

    const payload = createPostHogPayload(
      {
        functionName: 'tickets.createTicket',
        isErrorLike: true,
        level: 'error',
        message: 'ticket creation failed',
        rawLine: '[req:abc123] something bad',
        requestId: 'abc123',
        sentryTraceId: '',
        structured: null,
      },
      config,
    );

    const [scopeLog] = payload.resourceLogs[0].scopeLogs;
    const logRecord = scopeLog.logRecords[0];
    const attributes = Object.fromEntries(
      logRecord.attributes.map((attribute) => [
        attribute.key,
        attribute.value.stringValue,
      ]),
    );

    expect(attributes['convex.request_id']).toBe('abc123');
    expect(attributes['convex.function_name']).toBe('tickets.createTicket');
    expect(attributes['convex.raw_line']).toBe('[req:abc123] something bad');
    expect(attributes['convex.target']).toBe('prod');
  });

  it('maps OTel severityNumber consistently by level', () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'posthog',
      POSTHOG_LOGS_PROJECT_TOKEN: 'test-token',
    });

    expect(
      createPostHogPayload(baseNormalizedEvent('info'), config).resourceLogs[0]
        .scopeLogs[0].logRecords[0].severityNumber,
    ).toBe(9);
    expect(
      createPostHogPayload(baseNormalizedEvent('debug'), config).resourceLogs[0]
        .scopeLogs[0].logRecords[0].severityNumber,
    ).toBe(5);
    expect(
      createPostHogPayload(baseNormalizedEvent('warning'), config)
        .resourceLogs[0].scopeLogs[0].logRecords[0].severityNumber,
    ).toBe(13);
    expect(
      createPostHogPayload(baseNormalizedEvent('error'), config).resourceLogs[0]
        .scopeLogs[0].logRecords[0].severityNumber,
    ).toBe(17);
    expect(
      createPostHogPayload(baseNormalizedEvent('fatal'), config).resourceLogs[0]
        .scopeLogs[0].logRecords[0].severityNumber,
    ).toBe(21);
  });

  it('uses POSTHOG_LOGS_SERVICE_NAME for OTLP resource service.name', () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'posthog',
      POSTHOG_LOGS_PROJECT_TOKEN: 'test-token',
      POSTHOG_LOGS_SERVICE_NAME: 'posthog-prod-service',
    });

    const payload = createPostHogPayload(baseNormalizedEvent('info'), config);
    const serviceNameAttribute =
      payload.resourceLogs[0].resource.attributes.find(
        (attribute) => attribute.key === 'service.name',
      );

    expect(serviceNameAttribute?.value.stringValue).toBe(
      'posthog-prod-service',
    );
  });

  it('uses POSTHOG_LOGS_SERVICE_NAME for dev target OTLP resource service.name', () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'posthog',
      CONVEX_LOG_TARGET: 'dev',
      POSTHOG_LOGS_PROJECT_TOKEN: 'test-token',
      POSTHOG_LOGS_SERVICE_NAME: 'posthog-prod-service',
    });

    const payload = createPostHogPayload(baseNormalizedEvent('info'), config);
    const serviceNameAttribute =
      payload.resourceLogs[0].resource.attributes.find(
        (attribute) => attribute.key === 'service.name',
      );

    expect(serviceNameAttribute?.value.stringValue).toBe(
      'posthog-prod-service',
    );
  });

  it('normalizes structured Convex JSONL as error-level with function and request id', () => {
    const rawLine =
      '{"kind":"FunctionExecution","function":"tickets.createTicket","requestId":"req-json","executionId":"ex-json","success":false,"error":null}';
    const event = normalizeEvent(JSON.parse(rawLine), rawLine);

    expect(event).toEqual(
      expect.objectContaining({
        functionName: 'tickets.createTicket',
        requestId: 'req-json',
        level: 'error',
        isErrorLike: true,
      }),
    );
  });

  it('normalizes structured Convex console errors from explicit level fields', () => {
    const rawLine = JSON.stringify({
      kind: 'console',
      level: 'ERROR',
      message: 'checkout failed',
      function: 'stripe.checkout',
    });
    const event = normalizeEvent(JSON.parse(rawLine), rawLine);

    expect(event).toEqual(
      expect.objectContaining({
        functionName: 'stripe.checkout',
        level: 'error',
        isErrorLike: true,
        message: 'checkout failed',
      }),
    );
  });

  it('normalizes structured Convex log errors from logLevel fields', () => {
    const rawLine = JSON.stringify({
      kind: 'log',
      logLevel: 'ERROR',
      logLine: 'webhook failed',
      udfPath: 'stripe.webhooks',
    });
    const event = normalizeEvent(JSON.parse(rawLine), rawLine);

    expect(event).toEqual(
      expect.objectContaining({
        functionName: 'stripe.webhooks',
        level: 'error',
        isErrorLike: true,
        message: 'webhook failed',
      }),
    );
  });

  it('normalizes nested Convex Progress logLines as errors', () => {
    const rawLine = JSON.stringify({
      kind: 'Progress',
      udfType: 'Action',
      identifier: 'stripe/actions:verifyAndProcessWebhook',
      requestId: 'req-progress',
      logLines: [
        {
          messages: ['[ERROR][stripe] webhook failed', '{ eventId: "evt_1" }'],
          level: 'ERROR',
        },
      ],
    });
    const event = normalizeEvent(JSON.parse(rawLine), rawLine);

    expect(event).toEqual(
      expect.objectContaining({
        functionName: 'stripe/actions:verifyAndProcessWebhook',
        requestId: 'req-progress',
        level: 'error',
        isErrorLike: true,
        message: '[ERROR][stripe] webhook failed { eventId: "evt_1" }',
      }),
    );
  });

  it('treats structured warning logLines with failure words as error-like', () => {
    const rawLine = JSON.stringify({
      kind: 'Progress',
      udfType: 'Action',
      identifier: 'stripe/actions:verifyAndProcessWebhook',
      logLines: [
        {
          messages: [
            '[WARN][stripe] payment_intent.payment_failed missing orderId',
          ],
          level: 'WARN',
        },
      ],
    });
    const event = normalizeEvent(JSON.parse(rawLine), rawLine);

    expect(event).toEqual(
      expect.objectContaining({
        level: 'warning',
        isErrorLike: true,
      }),
    );
  });

  it('normalizes HTTP action 5xx completion statuses as error-like', () => {
    const rawLine = JSON.stringify({
      kind: 'Completion',
      udfType: 'HttpAction',
      identifier: 'POST /stripe/webhook',
      requestId: 'req-http-500',
      success: {status: '500'},
      error: null,
    });
    const event = normalizeEvent(JSON.parse(rawLine), rawLine);

    expect(event).toEqual(
      expect.objectContaining({
        functionName: 'POST /stripe/webhook',
        requestId: 'req-http-500',
        level: 'error',
        isErrorLike: true,
      }),
    );
  });

  it('normalizes HTTP action 4xx completion statuses as warning-level', () => {
    const rawLine = JSON.stringify({
      kind: 'Completion',
      udfType: 'HttpAction',
      identifier: 'GET /api/auth/*',
      requestId: 'req-http-404',
      success: {status: '404'},
      error: null,
    });
    const event = normalizeEvent(JSON.parse(rawLine), rawLine);

    expect(event).toEqual(
      expect.objectContaining({
        functionName: 'GET /api/auth/*',
        requestId: 'req-http-404',
        level: 'warning',
        isErrorLike: false,
      }),
    );
  });

  it('sanitizes message, raw line, and structured payload before PostHog delivery', () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'posthog',
      POSTHOG_LOGS_PROJECT_TOKEN: 'test-token',
    });
    const rawLine = JSON.stringify({
      kind: 'FunctionExecution',
      function: 'auth.resetPassword',
      requestId: 'req-pii',
      success: false,
      error:
        'failed for alice@example.com with token sk_live_secret and card 4242 4242 4242 4242',
      metadata: {
        email: 'alice@example.com',
        sessionToken: 'session-secret',
      },
    });

    const event = normalizeEvent(JSON.parse(rawLine), rawLine);
    if (!event) {
      throw new Error('Expected normalized event');
    }

    const payload = createPostHogPayload(event, config);
    const serialized = JSON.stringify(payload);
    const logRecord = payload.resourceLogs[0].scopeLogs[0].logRecords[0];
    const attributes = Object.fromEntries(
      logRecord.attributes.map((attribute) => [
        attribute.key,
        attribute.value.stringValue,
      ]),
    );

    expect(logRecord.body.stringValue).toContain('[REDACTED]');
    expect(attributes['convex.raw_line']).toContain('[REDACTED]');
    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).not.toContain('sk_live_secret');
    expect(serialized).not.toContain('4242 4242 4242 4242');
    expect(serialized).not.toContain('session-secret');
  });
});

describe('convex-log-forwarder sender routing', () => {
  it('routes sink=none without network calls', async () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'none',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await sendNormalizedEvent(
      {
        functionName: 'tickets.createTicket',
        isErrorLike: true,
        level: 'error',
        message: 'noop',
        rawLine: 'no-op',
        requestId: 'abc',
        sentryTraceId: '',
        structured: null,
      },
      config,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('routes sink=posthog to PostHog logs endpoint', async () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'posthog',
      POSTHOG_LOGS_PROJECT_TOKEN: 'test-token',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    } as Response);

    await sendNormalizedEvent(
      {
        functionName: 'tickets.createTicket',
        isErrorLike: true,
        level: 'error',
        message: 'forwarded',
        rawLine: 'no-op',
        requestId: 'req-1',
        sentryTraceId: '',
        structured: null,
      },
      config,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/i/v1/logs');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer test-token',
    );
    fetchSpy.mockRestore();
  });

  it('preserves Sentry envelope format for sink=sentry', async () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'sentry',
      SENTRY_DSN: 'https://public:private@o0.ingest.sentry.io/123',
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    } as Response);

    const event = {
      functionName: 'tickets.createTicket',
      isErrorLike: true,
      level: 'error',
      message: 'forwarded',
      rawLine: '[trace:trace-1] [req:req-1] failure',
      requestId: 'req-1',
      sentryTraceId: 'trace-1',
      structured: null,
    };

    await sendNormalizedEvent(event, config);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

    expect(url).toBe(
      (config as {sentryEnvelopeEndpoint: string}).sentryEnvelopeEndpoint,
    );
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Content-Type')).toBe(
      'application/x-sentry-envelope',
    );

    const body = init?.body;
    if (typeof body !== 'string') {
      throw new Error('Expected envelope body as string');
    }

    const [rawHeader, rawItemHeader, rawPayload] = body.split('\n');
    const envelopeHeader = JSON.parse(rawHeader);
    const itemHeader = JSON.parse(rawItemHeader);
    const sentryPayload = JSON.parse(rawPayload);

    expect(itemHeader.type).toBe('event');
    expect(envelopeHeader.dsn).toBe(
      'https://public:private@o0.ingest.sentry.io/123',
    );
    expect(envelopeHeader.event_id).toBe(sentryPayload.event_id);
    expect(sentryPayload.level).toBe('error');
    expect(sentryPayload.platform).toBe('node');
    expect(sentryPayload.message).toBe('forwarded');
    expect(sentryPayload.tags).toMatchObject({
      convex_target: 'prod',
      convex_function: 'tickets.createTicket',
      convex_request_id: 'req-1',
      sentry_trace_id: 'trace-1',
    });
    expect(sentryPayload.extra.convex_raw_line).toBe(
      '[trace:trace-1] [req:req-1] failure',
    );
    expect(sentryPayload.contexts?.trace?.trace_id).toBe('trace-1');
    expect(sentryPayload.contexts?.trace?.span_id).toBe('req-1');
    fetchSpy.mockRestore();
  });

  it('sends sanitized Sentry payloads for raw Convex logs', async () => {
    const config = buildRuntimeConfig({
      CONVEX_LOG_SINK: 'sentry',
      SENTRY_DSN: 'https://public:private@o0.ingest.sentry.io/123',
    });
    const rawLine = JSON.stringify({
      kind: 'FunctionExecution',
      function: 'auth.resetPassword',
      requestId: 'req-pii',
      success: false,
      error:
        'failed for alice@example.com with token sk_live_secret and card 4242 4242 4242 4242',
      metadata: {
        email: 'alice@example.com',
        sessionToken: 'session-secret',
      },
    });
    const event = normalizeEvent(JSON.parse(rawLine), rawLine);
    if (!event) {
      throw new Error('Expected normalized event');
    }

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    } as Response);

    await sendNormalizedEvent(event, config);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = init?.body;
    if (typeof body !== 'string') {
      throw new Error('Expected envelope body as string');
    }

    const sentryPayload = JSON.parse(body.split('\n')[2]);
    const serialized = JSON.stringify(sentryPayload);

    expect(sentryPayload.message).toContain('[REDACTED]');
    expect(sentryPayload.extra.convex_raw_line).toContain('[REDACTED]');
    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).not.toContain('sk_live_secret');
    expect(serialized).not.toContain('4242 4242 4242 4242');
    expect(serialized).not.toContain('session-secret');
    fetchSpy.mockRestore();
  });
});

function baseNormalizedEvent(
  level: 'debug' | 'info' | 'warning' | 'error' | 'fatal',
) {
  return {
    functionName: 'tickets.createTicket',
    isErrorLike: true,
    level,
    message: 'ticket creation failed',
    rawLine: '[req:abc123] something bad',
    requestId: 'abc123',
    sentryTraceId: '',
    structured: null,
  };
}
