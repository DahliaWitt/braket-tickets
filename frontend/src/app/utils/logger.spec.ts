// Tests run in development mode (environment.production = false)
// so debug/info logs should output

import type * as EnvironmentModule from '../../environments/environment';
import type * as LoggerModule from './logger';

describe('logger', () => {
  let logger: typeof LoggerModule.logger;
  let sanitize: typeof LoggerModule.sanitize;
  let REDACTED_VALUE: typeof LoggerModule.REDACTED_VALUE;
  let environment: typeof EnvironmentModule.environment;
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    info: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
    groupCollapsed: ReturnType<typeof vi.spyOn>;
    groupEnd: ReturnType<typeof vi.spyOn>;
    time: ReturnType<typeof vi.spyOn>;
    timeEnd: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(async () => {
    vi.resetModules();
    ({logger, sanitize, REDACTED_VALUE} = await import('./logger'));
    ({environment} = await import('../../environments/environment'));
    environment.production = false;
    localStorage.removeItem('debug');
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(vi.fn()),
      info: vi.spyOn(console, 'info').mockImplementation(vi.fn()),
      warn: vi.spyOn(console, 'warn').mockImplementation(vi.fn()),
      error: vi.spyOn(console, 'error').mockImplementation(vi.fn()),
      groupCollapsed: vi
        .spyOn(console, 'groupCollapsed')
        .mockImplementation(vi.fn()),
      groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(vi.fn()),
      time: vi.spyOn(console, 'time').mockImplementation(vi.fn()),
      timeEnd: vi.spyOn(console, 'timeEnd').mockImplementation(vi.fn()),
    };
    // Clear localStorage debug flag
    localStorage.removeItem('debug');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.removeItem('debug');
  });

  describe('sanitize', () => {
    it('should redact password fields', () => {
      const input = {displayName: 'john', password: 'secret123'};
      const result = sanitize(input);
      expect(result).toEqual({displayName: 'john', password: REDACTED_VALUE});
    });

    it('should redact email fields', () => {
      const input = {name: 'John', email: 'john@example.com'};
      const result = sanitize(input);
      expect(result).toEqual({name: 'John', email: REDACTED_VALUE});
    });

    it('should redact token fields', () => {
      const input = {
        userId: '123',
        accessToken: 'abc123',
        refreshToken: 'xyz789',
      };
      const result = sanitize(input);
      expect(result).toEqual({
        userId: '123',
        accessToken: REDACTED_VALUE,
        refreshToken: REDACTED_VALUE,
      });
    });

    it('should redact API key fields', () => {
      const input = {apiKey: 'sk-123456', apiSecret: 'super-secret'};
      const result = sanitize(input);
      expect(result).toEqual({
        apiKey: REDACTED_VALUE,
        apiSecret: REDACTED_VALUE,
      });
    });

    it('should handle nested objects', () => {
      const input = {
        user: {name: 'John', email: 'john@example.com'},
        auth: {password: 'secret', token: 'abc'},
      };
      const result = sanitize(input);
      expect(result).toEqual({
        user: {name: 'John', email: REDACTED_VALUE},
        auth: {password: REDACTED_VALUE, token: REDACTED_VALUE},
      });
    });

    it('should handle arrays', () => {
      const input = [
        {name: 'User 1', email: 'user1@example.com'},
        {name: 'User 2', email: 'user2@example.com'},
      ];
      const result = sanitize(input);
      expect(result).toEqual([
        {name: 'User 1', email: REDACTED_VALUE},
        {name: 'User 2', email: REDACTED_VALUE},
      ]);
    });

    it('should handle Error objects', () => {
      const error = new Error('Failed with email: john@example.com');
      (error as unknown as Record<string, unknown>).code = 'AUTH_ERROR';
      (error as unknown as Record<string, unknown>).apiKey = 'secret-key';
      const result = sanitize(error) as Error & {code: string; apiKey: string};

      expect(result.message).toBe('Failed with email: [REDACTED]');
      expect(result.code).toBe('AUTH_ERROR');
      expect(result.apiKey).toBe(REDACTED_VALUE);
    });

    it('should redact emails in strings', () => {
      const input = 'Contact support at help@example.com for assistance';
      const result = sanitize(input);
      expect(result).toBe('Contact support at [REDACTED] for assistance');
    });

    it('should handle null and undefined', () => {
      expect(sanitize(null)).toBe(null);
      expect(sanitize(undefined)).toBe(undefined);
    });

    it('should handle primitives', () => {
      expect(sanitize('string')).toBe('string');
      expect(sanitize(123)).toBe(123);
      expect(sanitize(true)).toBe(true);
    });

    it('should handle Date objects', () => {
      const date = new Date('2024-01-15');
      const result = sanitize(date);
      expect(result).toEqual(date);
      expect(result).not.toBe(date); // Should be a new instance
    });

    it('should redact credit card numbers', () => {
      const input = {cardNumber: '4111-1111-1111-1111', cvv: '123'};
      const result = sanitize(input);
      expect(result).toEqual({cardNumber: REDACTED_VALUE, cvv: REDACTED_VALUE});
    });

    it('should redact session and auth tokens', () => {
      const input = {
        sessionId: 'sess_123',
        csrfToken: 'csrf_abc',
        nonce: 'nonce_xyz',
      };
      const result = sanitize(input);
      expect(result).toEqual({
        sessionId: REDACTED_VALUE,
        csrfToken: REDACTED_VALUE,
        nonce: REDACTED_VALUE,
      });
    });

    it('should handle case-insensitive field matching', () => {
      const input = {
        PASSWORD: 'secret',
        ApiKey: 'key123',
        EmailAddress: 'test@example.com',
      };
      const result = sanitize(input);
      expect(result).toEqual({
        PASSWORD: REDACTED_VALUE,
        ApiKey: REDACTED_VALUE,
        EmailAddress: REDACTED_VALUE,
      });
    });

    it('does not redact non-sensitive keys that only contain sensitive substrings', () => {
      const input = {
        secretary: 'Jordan',
        detokenize: 'enabled',
      };

      expect(sanitize(input)).toEqual(input);
    });

    it('redacts sensitive keys across separator-based naming conventions', () => {
      const input = {
        session_token: 'sess_123',
        'api-key': 'key_123',
      };

      expect(sanitize(input)).toEqual({
        session_token: REDACTED_VALUE,
        'api-key': REDACTED_VALUE,
      });
    });

    it('redacts collapsed compound sensitive keys', () => {
      const input = {
        accesstoken: 'token_123',
        apikey: 'key_123',
      };

      expect(sanitize(input)).toEqual({
        accesstoken: REDACTED_VALUE,
        apikey: REDACTED_VALUE,
      });
    });

    it('should handle Map objects by sanitizing entries', () => {
      const input = new Map([
        ['user', {name: 'John', email: 'john@example.com'}],
        ['credentials', {password: 'secret123'}],
      ]);
      const result = sanitize(input);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('user')).toEqual({name: 'John', email: REDACTED_VALUE});
      expect(result.get('credentials')).toEqual({password: REDACTED_VALUE});
    });

    it('should handle Set objects by sanitizing values', () => {
      const input = new Set([
        {name: 'User 1', email: 'user1@example.com'},
        {name: 'User 2', apiKey: 'key-123'},
      ]);
      const result = sanitize(input);

      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(2);
      const values = [...result.values()];
      expect(values).toContainEqual({name: 'User 1', email: REDACTED_VALUE});
      expect(values).toContainEqual({name: 'User 2', apiKey: REDACTED_VALUE});
    });

    it('should handle RegExp objects by creating a copy', () => {
      const input = /test-pattern/gi;
      const result = sanitize(input);

      expect(result).toBeInstanceOf(RegExp);
      expect(result.source).toBe(input.source);
      expect(result.flags).toBe(input.flags);
      expect(result).not.toBe(input);
    });

    it('should handle empty Map and Set', () => {
      const emptyMap = new Map();
      const emptySet = new Set();
      const sanitizedMap = sanitize(emptyMap);
      const sanitizedSet = sanitize(emptySet);

      expect(sanitizedMap).toBeInstanceOf(Map);
      expect(sanitizedMap.size).toBe(0);
      expect(sanitizedSet).toBeInstanceOf(Set);
      expect(sanitizedSet.size).toBe(0);
    });

    it('should sanitize nested Map/Set structures', () => {
      const nestedMap = new Map([
        ['outer', new Map([['inner', {email: 'nested@example.com'}]])],
      ]);
      const result = sanitize(nestedMap);

      expect(result).toBeInstanceOf(Map);
      const innerMap = result.get('outer');
      expect(innerMap).toBeInstanceOf(Map);
      expect((innerMap as Map<string, unknown>).get('inner')).toEqual({
        email: REDACTED_VALUE,
      });
    });
  });

  describe('debug (development mode)', () => {
    it('should call console.log with styled DEBUG prefix in development', () => {
      logger.debug('test message');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '%c[DEBUG]%c test message',
        'color: #888; font-weight: bold',
        'color: inherit',
      );
    });

    it('should pass multiple arguments', () => {
      logger.debug('message', {data: 123}, 'extra');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '%c[DEBUG]%c message',
        'color: #888; font-weight: bold',
        'color: inherit',
        {data: 123},
        'extra',
      );
    });
  });

  describe('info (development mode)', () => {
    it('should call console.info with styled INFO prefix in development', () => {
      logger.info('service started');
      expect(consoleSpy.info).toHaveBeenCalledWith(
        '%c[INFO]%c service started',
        'color: #4a9eff; font-weight: bold',
        'color: inherit',
      );
    });

    it('should pass multiple arguments', () => {
      logger.info('init', 'complete');
      expect(consoleSpy.info).toHaveBeenCalledWith(
        '%c[INFO]%c init',
        'color: #4a9eff; font-weight: bold',
        'color: inherit',
        'complete',
      );
    });
  });

  describe('warn', () => {
    it('should call console.warn with styled WARN prefix', () => {
      logger.warn('potential issue');
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        '%c[WARN]%c potential issue',
        'color: #ffa500; font-weight: bold',
        'color: inherit',
      );
    });

    it('should pass context objects', () => {
      const context = {userId: 'abc', action: 'delete'};
      logger.warn('risky operation', context);
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        '%c[WARN]%c risky operation',
        'color: #ffa500; font-weight: bold',
        'color: inherit',
        context,
      );
    });
  });

  describe('error', () => {
    it('should call console.error with styled ERROR prefix', () => {
      logger.error('something failed');
      expect(consoleSpy.error).toHaveBeenCalledWith(
        '%c[ERROR]%c something failed',
        'color: #ff4444; font-weight: bold',
        'color: inherit',
      );
    });

    it('should pass Error objects', () => {
      const err = new Error('test error');
      logger.error('operation failed', err);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        '%c[ERROR]%c operation failed',
        'color: #ff4444; font-weight: bold',
        'color: inherit',
        expect.objectContaining({
          message: 'test error',
          name: 'Error',
        }),
      );
    });

    it('should handle multiple error arguments', () => {
      const err1 = new Error('first');
      const err2 = new Error('second');
      logger.error('multiple failures', err1, err2);
      expect(consoleSpy.error).toHaveBeenCalledWith(
        '%c[ERROR]%c multiple failures',
        'color: #ff4444; font-weight: bold',
        'color: inherit',
        expect.objectContaining({message: 'first', name: 'Error'}),
        expect.objectContaining({message: 'second', name: 'Error'}),
      );
    });
  });

  describe('verbose', () => {
    it('should call console.log with styled VERBOSE prefix in development', () => {
      logger.verbose('extra detail');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '%c[VERBOSE]%c extra detail',
        'color: #666; font-style: italic',
        'color: #888',
      );
    });
  });

  describe('group', () => {
    it('should create collapsed group by default', () => {
      logger.group('TestGroup');
      expect(consoleSpy.groupCollapsed).toHaveBeenCalledWith('[TestGroup]');
    });

    it('should close unmatched groups even when debug gating changes', () => {
      environment.production = true;
      localStorage.setItem('debug', 'true');

      logger.group('TestGroup');
      localStorage.removeItem('debug');
      logger.groupEnd();

      expect(consoleSpy.groupCollapsed).toHaveBeenCalledWith('[TestGroup]');
      expect(consoleSpy.groupEnd).toHaveBeenCalledTimes(1);
    });

    it('should end group', () => {
      logger.group('TestGroup');
      logger.groupEnd();
      expect(consoleSpy.groupEnd).toHaveBeenCalled();
    });
  });

  describe('debug cache', () => {
    it('refreshes cached debug state after the cache window', () => {
      vi.useFakeTimers();
      environment.production = true;
      localStorage.setItem('debug', 'true');

      logger.info('debug override enabled');
      localStorage.removeItem('debug');
      logger.info('debug override removed');

      expect(consoleSpy.info).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(5_001);
      logger.info('after cache expiry');
      expect(consoleSpy.info).toHaveBeenCalledTimes(2);
    });
  });

  describe('timing', () => {
    it('should start timer', () => {
      logger.time('operation');
      expect(consoleSpy.time).toHaveBeenCalledWith('[TIME] operation');
    });

    it('should ignore duplicate active timers', () => {
      logger.time('operation');
      logger.time('operation');
      expect(consoleSpy.time).toHaveBeenCalledTimes(1);
    });

    it('should end timer', () => {
      logger.time('operation');
      logger.timeEnd('operation');
      expect(consoleSpy.timeEnd).toHaveBeenCalledWith('[TIME] operation');
    });

    it('should ignore timer ends without an active timer', () => {
      logger.timeEnd('operation');
      expect(consoleSpy.timeEnd).not.toHaveBeenCalled();
    });

    it('should end active timers when debug logging is disabled later', () => {
      logger.time('operation');
      environment.production = true;
      logger.timeEnd('operation');
      environment.production = false;
      logger.time('operation');

      expect(consoleSpy.timeEnd).toHaveBeenCalledWith('[TIME] operation');
      expect(consoleSpy.time).toHaveBeenCalledTimes(2);
    });
  });

  describe('general behavior', () => {
    it('should handle undefined and null values', () => {
      logger.debug('test', undefined, null, 'valid');
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '%c[DEBUG]%c test',
        'color: #888; font-weight: bold',
        'color: inherit',
        undefined,
        null,
        'valid',
      );
    });
  });

  describe('PII scrubbing in logger methods', () => {
    it('should redact sensitive data in debug logs', () => {
      logger.debug('User data', {
        name: 'John',
        email: 'john@example.com',
        password: 'secret',
      });
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '%c[DEBUG]%c User data',
        'color: #888; font-weight: bold',
        'color: inherit',
        {name: 'John', email: REDACTED_VALUE, password: REDACTED_VALUE},
      );
    });

    it('should redact sensitive data in info logs', () => {
      logger.info('Login success', {userId: '123', token: 'abc123'});
      expect(consoleSpy.info).toHaveBeenCalledWith(
        '%c[INFO]%c Login success',
        'color: #4a9eff; font-weight: bold',
        'color: inherit',
        {userId: '123', token: REDACTED_VALUE},
      );
    });

    it('should redact sensitive data in warn logs', () => {
      logger.warn('Auth warning', {apiKey: 'sk-123', message: 'Expired token'});
      expect(consoleSpy.warn).toHaveBeenCalledWith(
        '%c[WARN]%c Auth warning',
        'color: #ffa500; font-weight: bold',
        'color: inherit',
        {apiKey: REDACTED_VALUE, message: 'Expired token'},
      );
    });

    it('should redact sensitive data in error logs', () => {
      logger.error('Login failed', {
        email: 'user@example.com',
        password: 'wrong',
      });
      expect(consoleSpy.error).toHaveBeenCalledWith(
        '%c[ERROR]%c Login failed',
        'color: #ff4444; font-weight: bold',
        'color: inherit',
        {email: REDACTED_VALUE, password: REDACTED_VALUE},
      );
    });

    it('should redact emails in log messages', () => {
      logger.info('Sending email to admin@example.com');
      expect(consoleSpy.info).toHaveBeenCalledWith(
        '%c[INFO]%c Sending email to [REDACTED]',
        'color: #4a9eff; font-weight: bold',
        'color: inherit',
      );
    });

    it('should redact sensitive data in verbose logs', () => {
      logger.verbose('Full context', {sessionId: 'sess_123', data: 'public'});
      expect(consoleSpy.log).toHaveBeenCalledWith(
        '%c[VERBOSE]%c Full context',
        'color: #666; font-style: italic',
        'color: #888',
        {sessionId: REDACTED_VALUE, data: 'public'},
      );
    });

    it('should redact emails in group labels', () => {
      logger.group('Processing user john@example.com');
      expect(consoleSpy.groupCollapsed).toHaveBeenCalledWith(
        '[Processing user [REDACTED]]',
      );
    });

    it('should redact emails in timing labels', () => {
      logger.time('api-call-for-admin@example.com');
      expect(consoleSpy.time).toHaveBeenCalledWith('[TIME] [REDACTED]');
    });
  });
});
