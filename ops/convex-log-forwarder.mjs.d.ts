/**
 * Type declarations for convex-log-forwarder.mjs
 *
 * The .mjs extension cannot be resolved by TypeScript when the IDE falls back
 * to the root tsconfig.json (which lacks allowJs). This declaration file lets
 * both the IDE and tsc resolve the module properly.
 */

declare module './convex-log-forwarder.mjs' {
  // ── Normalized event ──────────────────────────────────────────────

  interface NormalizedEvent {
    functionName: string;
    isErrorLike: boolean;
    level: 'debug' | 'info' | 'warning' | 'error' | 'fatal';
    message: string;
    rawLine: string;
    requestId: string;
    sentryTraceId: string;
    structured: Record<string, unknown> | null | undefined;
  }

  // ── Runtime config (discriminated by sink) ─────────────────────────

  interface BaseConfig {
    convexLogTarget: string;
    convexLogsHistory: number;
    includeSuccess: boolean;
    forwardAll: boolean;
    convexEnvFile: string;
    reconnectDelayMs: number;
    maxInMemoryDedup: number;
    sink: 'posthog' | 'sentry' | 'none';
  }

  interface PostHogConfig extends BaseConfig {
    sink: 'posthog';
    posthogServiceName: string;
    posthogHost: string;
    posthogEndpoint: string;
    posthogProjectToken: string;
  }

  interface SentryConfig extends BaseConfig {
    sink: 'sentry';
    sentryDsn: string;
    sentryEnvelopeEndpoint: string;
  }

  interface NoneConfig extends BaseConfig {
    sink: 'none';
    posthogProjectToken: undefined;
    posthogHost: undefined;
    posthogEndpoint: undefined;
    sentryDsn: undefined;
    sentryEnvelopeEndpoint: undefined;
  }

  type RuntimeConfig = PostHogConfig | SentryConfig | NoneConfig;

  // ── PostHog OTLP payload ──────────────────────────────────────────

  interface AttributeValue {
    stringValue: string;
  }

  interface Attribute {
    key: string;
    value: AttributeValue;
  }

  interface LogRecord {
    timeUnixNano: string;
    severityText: string;
    severityNumber: number;
    body: {stringValue: string};
    attributes: Attribute[];
  }

  interface ScopeLog {
    scope: {name: string; version: string};
    logRecords: LogRecord[];
  }

  interface PostHogPayload {
    resourceLogs: Array<{
      resource: {attributes: Attribute[]};
      scopeLogs: ScopeLog[];
    }>;
  }

  // ── Exported functions ────────────────────────────────────────────

  export function buildRuntimeConfig(
    env?: Record<string, string | undefined>,
  ): RuntimeConfig;

  export function normalizeEvent(
    parsed: unknown,
    rawLine: string,
  ): NormalizedEvent | null;

  export function createPostHogPayload(
    event: NormalizedEvent,
    config: RuntimeConfig,
  ): PostHogPayload;

  export function sendNormalizedEvent(
    event: NormalizedEvent,
    config: RuntimeConfig,
  ): Promise<void>;
}
