#!/usr/bin/env node

import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

import {sanitize} from '../shared/log-sanitizer.mjs';

const ERROR_WORD_RE =
  /(^|[^a-z0-9])(error|exception|fatal|panic|failed|failure|uncaught)([^a-z0-9]|$)/i;
const DEFAULT_SINK = 'sentry';

const recentlyForwarded = new Map();

async function runForever(config) {
  try {
    await streamConvexLogs(config);
    console.warn(
      '[convex-log-forwarder] convex logs stream ended, reconnecting...',
    );
  } catch (error) {
    console.error('[convex-log-forwarder] stream failed:', error);
  }
  await sleep(config.reconnectDelayMs);
  return runForever(config);
}

async function streamConvexLogs(config) {
  const args = ['logs', '--jsonl'];
  if (config.includeSuccess) {
    args.push('--success');
  }
  if (config.convexLogsHistory > 0) {
    args.push('--history', String(config.convexLogsHistory));
  }
  if (config.convexLogTarget === 'prod') {
    args.push('--prod');
  } else if (config.convexLogTarget !== 'dev') {
    args.push('--deployment-name', config.convexLogTarget);
  }
  if (config.convexEnvFile) {
    args.push('--env-file', config.convexEnvFile);
  }

  console.log(`[convex-log-forwarder] starting: convex ${args.join(' ')}`);

  const child = spawn('convex', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let pending = Promise.resolve();

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      pending = pending
        .then(() => processLogLine(line, config))
        .catch((error) => {
          console.error(
            '[convex-log-forwarder] failed to process line:',
            error,
          );
        });
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        console.warn(`[convex-log-forwarder] convex stderr: ${trimmed}`);
      }
    }
  });

  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') {
        resolve();
        return;
      }
      reject(
        new Error(
          `convex logs exited with code=${String(code)} signal=${String(signal)}`,
        ),
      );
    });
  });

  await pending;
}

async function processLogLine(line, config) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('Watching logs for')) {
    return;
  }

  let parsed = null;
  if (trimmed.startsWith('{')) {
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
  }

  const normalized = normalizeEvent(parsed, trimmed);
  if (!normalized) {
    return;
  }

  if (!config.forwardAll && !normalized.isErrorLike) {
    return;
  }

  const dedupKey = createHash('sha1').update(trimmed).digest('hex');
  if (recentlyForwarded.has(dedupKey)) {
    return;
  }
  rememberDedupKey(dedupKey, config.maxInMemoryDedup);

  await sendNormalizedEvent(normalized, config);
}

function normalizeEvent(parsed, rawLine) {
  const fromObject = parsed && typeof parsed === 'object' ? parsed : null;
  const logLineSummary = summarizeConvexLogLines(fromObject?.logLines);

  const levelCandidate = getStringValue(
    fromObject?.level,
    fromObject?.severity,
    fromObject?.logLevel,
    logLineSummary.level,
  );

  const messageCandidate = getStringValue(
    fromObject?.message,
    fromObject?.msg,
    fromObject?.errorMessage,
    fromObject?.error,
    fromObject?.logLine,
    logLineSummary.message,
  );

  const functionCandidate = getStringValue(
    fromObject?.function,
    fromObject?.functionName,
    fromObject?.udfPath,
    fromObject?.identifier,
    fromObject?.name,
  );

  const requestIdFromObject = getStringValue(
    fromObject?.requestId,
    fromObject?.request_id,
    fromObject?.requestIdentifier,
  );

  const reqMatch = rawLine.match(/\[req:([^\]]+)\]/);
  const traceMatch = rawLine.match(/\[trace:([^\]]+)\]/);

  const requestIdCandidate =
    requestIdFromObject ?? (reqMatch ? reqMatch[1] : null);
  const sentryTraceIdCandidate = traceMatch ? traceMatch[1] : null;

  // For structured Convex logs (have "kind" or "executionId"), determine error
  // status from actual field values — NOT from regex on the raw JSON string.
  // The raw JSON always contains `"error":null` which would false-positive match.
  const isConvexStructured =
    fromObject && ('kind' in fromObject || 'executionId' in fromObject);
  const level = isConvexStructured
    ? normalizeConvexLevel(fromObject, logLineSummary.level)
    : normalizeLevel(levelCandidate, rawLine);
  const rawMessage = messageCandidate ?? rawLine;
  const sanitizedStructured = fromObject ? sanitize(fromObject) : undefined;
  const sanitizedRawLine = sanitizedStructured
    ? JSON.stringify(sanitizedStructured)
    : sanitize(rawLine);
  const isErrorLike = isConvexStructured
    ? level === 'error' ||
      level === 'fatal' ||
      (messageCandidate
        ? ERROR_WORD_RE.test(messageCandidate.toLowerCase())
        : false)
    : level === 'error' ||
      level === 'fatal' ||
      ERROR_WORD_RE.test(`${rawMessage} ${rawLine}`.toLowerCase());

  return {
    functionName: functionCandidate ?? '',
    isErrorLike,
    level,
    message: sanitize(rawMessage).slice(0, 2000),
    rawLine: sanitizedRawLine.slice(0, 4000),
    requestId: requestIdCandidate ?? '',
    sentryTraceId: sentryTraceIdCandidate ?? '',
    structured: sanitizedStructured,
  };
}

function summarizeConvexLogLines(logLines) {
  if (!Array.isArray(logLines) || logLines.length === 0) {
    return {level: null, message: null};
  }

  const messages = [];
  let highestLevel = null;

  for (const logLine of logLines) {
    if (!logLine || typeof logLine !== 'object') {
      continue;
    }

    const level = getStringValue(logLine.level, logLine.severity);
    highestLevel = higherSeverity(
      highestLevel,
      normalizeExplicitConvexLevel(level),
    );

    if (Array.isArray(logLine.messages)) {
      for (const message of logLine.messages) {
        if (typeof message === 'string' && message.trim()) {
          messages.push(message.trim());
        }
      }
      continue;
    }

    const message = getStringValue(logLine.message, logLine.logLine);
    if (message) {
      messages.push(message);
    }
  }

  return {
    level: highestLevel,
    message: messages.length > 0 ? messages.join(' ') : null,
  };
}

function higherSeverity(current, candidate) {
  const severityRank = {
    debug: 1,
    info: 2,
    warning: 3,
    error: 4,
    fatal: 5,
  };

  if (!candidate) {
    return current;
  }

  if (!current || severityRank[candidate] > severityRank[current]) {
    return candidate;
  }

  return current;
}

async function sendNormalizedEvent(event, config) {
  if (config.sink === 'none') {
    return;
  }
  if (config.sink === 'sentry') {
    await sendToSentry(event, config);
  }
}

async function sendToSentry(event, config) {
  const eventId = randomUUID().replace(/-/g, '');
  const payload = {
    event_id: eventId,
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: event.level,
    logger: 'convex-log-forwarder',
    message: event.message,
    tags: {
      convex_target: config.convexLogTarget,
      ...(event.functionName ? {convex_function: event.functionName} : {}),
      ...(event.requestId ? {convex_request_id: event.requestId} : {}),
      ...(event.sentryTraceId ? {sentry_trace_id: event.sentryTraceId} : {}),
    },
    ...(event.sentryTraceId
      ? {
          contexts: {
            trace: {
              trace_id: event.sentryTraceId,
              span_id: event.requestId || undefined,
            },
          },
        }
      : {}),
    extra: {
      convex_raw_line: event.rawLine,
      ...(event.structured ? {convex_event: event.structured} : {}),
    },
  };

  const envelopeHeader = {
    dsn: config.sentryDsn,
    event_id: eventId,
    sent_at: new Date().toISOString(),
  };
  const itemHeader = {type: 'event'};
  const envelopeBody = `${JSON.stringify(envelopeHeader)}\n${JSON.stringify(itemHeader)}\n${JSON.stringify(payload)}`;

  const response = await fetch(config.sentryEnvelopeEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
    },
    body: envelopeBody,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sentry rejected event (${response.status}): ${body}`);
  }
}

function rememberDedupKey(key, limit) {
  recentlyForwarded.set(key, Date.now());
  if (recentlyForwarded.size <= limit) {
    return;
  }
  const firstKey = recentlyForwarded.keys().next().value;
  if (firstKey) {
    recentlyForwarded.delete(firstKey);
  }
}

function getStringValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeConvexLevel(obj, logLineLevel = null) {
  const explicitLevel = normalizeExplicitConvexLevel(
    getStringValue(obj.level, obj.severity, obj.logLevel, logLineLevel),
  );
  if (explicitLevel) return explicitLevel;
  // Convex completion logs: error field is a string when the function failed, null on success
  if (typeof obj.error === 'string' && obj.error.trim()) return 'error';
  // Some Convex log formats use success: false
  if (obj.success === false) return 'error';
  const httpStatusLevel = normalizeHttpStatusLevel(obj.success);
  if (httpStatusLevel) return httpStatusLevel;
  return 'info';
}

function normalizeHttpStatusLevel(success) {
  if (!success || typeof success !== 'object') {
    return null;
  }

  const rawStatus = success.status;
  const status =
    typeof rawStatus === 'number'
      ? rawStatus
      : typeof rawStatus === 'string'
        ? Number.parseInt(rawStatus, 10)
        : NaN;

  if (!Number.isFinite(status)) {
    return null;
  }

  if (status >= 500) {
    return 'error';
  }

  if (status >= 400) {
    return 'warning';
  }

  return null;
}

function normalizeExplicitConvexLevel(candidate) {
  const normalized = candidate?.toLowerCase() ?? '';
  if (normalized === 'fatal') return 'fatal';
  if (normalized === 'error' || normalized === 'err') return 'error';
  if (normalized === 'warning' || normalized === 'warn') return 'warning';
  if (normalized === 'debug' || normalized === 'trace') return 'debug';
  if (normalized === 'info') return 'info';
  return null;
}

function normalizeLevel(candidate, rawLine) {
  const explicitLevel = normalizeExplicitConvexLevel(candidate);
  if (explicitLevel) return explicitLevel;
  if (ERROR_WORD_RE.test(rawLine.toLowerCase())) return 'error';
  return 'info';
}

function parsePositiveInt(value, fallback) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes')
    return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no')
    return false;
  return fallback;
}

function buildSentryEnvelopeEndpoint(dsn) {
  const parsed = new URL(dsn);
  const pathname = parsed.pathname.replace(/\/+$/, '');
  const projectId = pathname.split('/').findLast(Boolean);
  if (!projectId) {
    throw new Error('Unable to parse SENTRY_DSN project id');
  }
  const pathPrefix = pathname.slice(0, pathname.length - projectId.length);
  return `${parsed.protocol}//${parsed.host}${pathPrefix}api/${projectId}/envelope/`;
}

function normalizeSink(value) {
  if (!value || value.trim() === '') {
    return DEFAULT_SINK;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'sentry' || normalized === 'none') {
    return normalized;
  }
  throw new Error(`Unsupported CONVEX_LOG_SINK: ${value}`);
}

export function buildRuntimeConfig(env = process.env) {
  const source = env ?? {};
  const sink = normalizeSink(source.CONVEX_LOG_SINK);

  const config = {
    convexLogTarget: source.CONVEX_LOG_TARGET ?? 'prod',
    convexLogsHistory: parsePositiveInt(source.CONVEX_LOGS_HISTORY, 200),
    includeSuccess: parseBoolean(source.CONVEX_LOG_INCLUDE_SUCCESS, false),
    forwardAll: parseBoolean(source.CONVEX_LOG_FORWARD_ALL, false),
    convexEnvFile: source.CONVEX_ENV_FILE ?? '',
    reconnectDelayMs: parsePositiveInt(source.CONVEX_LOG_RECONNECT_MS, 3000),
    maxInMemoryDedup: parsePositiveInt(
      source.CONVEX_LOG_DEDUP_CACHE_SIZE,
      5000,
    ),
    sink,
  };

  if (sink === 'sentry') {
    const sentryDsn = source.SENTRY_DSN?.trim() ?? '';
    if (!sentryDsn) {
      throw new Error('SENTRY_DSN is required when sink is sentry');
    }
    const sentryEnvelopeEndpoint = buildSentryEnvelopeEndpoint(sentryDsn);
    return {
      ...config,
      sentryDsn,
      sentryEnvelopeEndpoint,
    };
  }

  return {
    ...config,
    sentryDsn: undefined,
    sentryEnvelopeEndpoint: undefined,
  };
}

const isMainModule = (() => {
  if (!process.argv[1]) {
    return false;
  }
  return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
})();

export {normalizeEvent, sendNormalizedEvent};

if (isMainModule) {
  await runForever(buildRuntimeConfig());
}
