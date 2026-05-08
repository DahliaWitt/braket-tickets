import {environment} from '../../environments/environment';
import {sanitize, sanitizeString} from '@shared/log-sanitizer';

export {REDACTED_VALUE, sanitize} from '@shared/log-sanitizer';

/**
 * Production-safe logger utility with localStorage debug override and PII scrubbing.
 *
 * - debug/info logs are suppressed in production by default
 * - warn/error logs always appear
 * - All log arguments are automatically scrubbed for sensitive data
 * - Set localStorage.setItem('debug', 'true') to enable debug/info in production
 * - Set localStorage.setItem('debug', 'verbose') for extra verbose output
 *
 * Usage:
 *   import { logger } from './logger';
 *   logger.debug('Some debug info', data);
 *   logger.info('Service initialized');
 *   logger.warn('This might be a problem', context);
 *   logger.error('Something failed', error);
 *
 * To enable in production console:
 *   localStorage.setItem('debug', 'true')  // enable info + debug
 *   localStorage.setItem('debug', 'verbose')  // enable verbose (extra detail)
 *   localStorage.removeItem('debug')  // disable
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'verbose';

/**
 * Sanitize arguments for logging by applying redaction to each.
 */
function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => sanitize(arg));
}

/**
 * Check if logging is enabled for a given level.
 * Caches the localStorage check for 5 seconds to avoid performance hit.
 */
let cachedDebugLevel: string | null = null;
let cacheTime = 0;
let activeDebugGroupCount = 0;
const activeTimerLabels = new Set<string>();
const CACHE_MS = 5000;

function getDebugLevel(): string | null {
  const now = Date.now();
  if (now - cacheTime > CACHE_MS) {
    try {
      cachedDebugLevel =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('debug')
          : null;
    } catch {
      cachedDebugLevel = null;
    }
    cacheTime = now;
  }
  return cachedDebugLevel;
}

function shouldLog(level: LogLevel): boolean {
  // warn and error always log
  if (level === 'warn' || level === 'error') return true;

  // In development, all levels log
  if (!environment.production) return true;

  // In production, check localStorage override
  const debugLevel = getDebugLevel();
  if (!debugLevel) return false;

  if (debugLevel === 'verbose') return true;
  if (debugLevel === 'true' || debugLevel === '1') {
    return level === 'debug' || level === 'info';
  }

  return false;
}

export const logger = {
  /**
   * Debug-level logging. Only outputs in development or with localStorage debug flag.
   * Automatically scrubs sensitive data from arguments.
   */
  debug: (message: string, ...args: unknown[]) => {
    if (shouldLog('debug')) {
      console.log(
        `%c[DEBUG]%c ${sanitizeString(message)}`,
        'color: #888; font-weight: bold',
        'color: inherit',
        ...sanitizeArgs(args),
      );
    }
  },

  /**
   * Info-level logging. Only outputs in development or with localStorage debug flag.
   * Automatically scrubs sensitive data from arguments.
   */
  info: (message: string, ...args: unknown[]) => {
    if (shouldLog('info')) {
      console.info(
        `%c[INFO]%c ${sanitizeString(message)}`,
        'color: #4a9eff; font-weight: bold',
        'color: inherit',
        ...sanitizeArgs(args),
      );
    }
  },

  /**
   * Warning-level logging. Always outputs.
   * Automatically scrubs sensitive data from arguments.
   */
  warn: (message: string, ...args: unknown[]) => {
    console.warn(
      `%c[WARN]%c ${sanitizeString(message)}`,
      'color: #ffa500; font-weight: bold',
      'color: inherit',
      ...sanitizeArgs(args),
    );
  },

  /**
   * Error-level logging. Always outputs.
   * Automatically scrubs sensitive data from arguments.
   */
  error: (message: string, ...args: unknown[]) => {
    console.error(
      `%c[ERROR]%c ${sanitizeString(message)}`,
      'color: #ff4444; font-weight: bold',
      'color: inherit',
      ...sanitizeArgs(args),
    );
  },

  /**
   * Verbose logging - extra detail, only with debug=verbose.
   * Automatically scrubs sensitive data from arguments.
   */
  verbose: (message: string, ...args: unknown[]) => {
    if (shouldLog('verbose')) {
      console.log(
        `%c[VERBOSE]%c ${sanitizeString(message)}`,
        'color: #666; font-style: italic',
        'color: #888',
        ...sanitizeArgs(args),
      );
    }
  },

  /**
   * Group related logs together.
   */
  group: (label: string, collapsed = true) => {
    const shouldLogDebug = shouldLog('debug');
    if (shouldLogDebug) {
      const sanitizedLabel = sanitizeString(label);
      if (collapsed) {
        console.groupCollapsed(`[${sanitizedLabel}]`);
      } else {
        console.group(`[${sanitizedLabel}]`);
      }
      activeDebugGroupCount += 1;
    }
  },

  groupEnd: () => {
    if (activeDebugGroupCount > 0) {
      console.groupEnd();
      activeDebugGroupCount -= 1;
    }
  },

  /**
   * Log with timing - useful for performance debugging.
   */
  time: (label: string) => {
    if (shouldLog('debug')) {
      const timerLabel = `[TIME] ${sanitizeString(label)}`;
      if (activeTimerLabels.has(timerLabel)) {
        return;
      }

      activeTimerLabels.add(timerLabel);
      console.time(timerLabel);
    }
  },

  timeEnd: (label: string) => {
    const timerLabel = `[TIME] ${sanitizeString(label)}`;
    if (!activeTimerLabels.has(timerLabel)) {
      return;
    }

    activeTimerLabels.delete(timerLabel);
    console.timeEnd(timerLabel);
  },
};
