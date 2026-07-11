import {describe, expect, it} from 'vitest';

import {REDACTED_VALUE, sanitize, sanitizeString} from './log-sanitizer.mjs';

// A realistic bearer-style token (base64url charset, no digit run that would
// coincidentally trip the phone-number heuristic).
const TOKEN = 'eyJhbGciOiJ_kd93ABxyzQwerty';

describe('sanitizeString labeled-secret redaction', () => {
  describe('key=value / key:value with NO surrounding whitespace', () => {
    it('redacts a token in a URL query string (?token=<value>)', () => {
      const input = `Http failure response for https://x/api/unsubscribe-preferences?token=${TOKEN}: 0 Unknown Error`;
      const output = sanitizeString(input);
      expect(output).not.toContain(TOKEN);
      expect(output).toContain(`token=${REDACTED_VALUE}`);
    });

    it('redacts authorization:<value> with no space', () => {
      const output = sanitizeString(`authorization:${TOKEN}`);
      expect(output).toBe(`authorization:${REDACTED_VALUE}`);
    });

    it('redacts token=<value> with no space', () => {
      const output = sanitizeString(`token=${TOKEN}`);
      expect(output).toBe(`token=${REDACTED_VALUE}`);
    });

    it('redacts token:<value> with no space', () => {
      const output = sanitizeString(`token:${TOKEN}`);
      expect(output).toBe(`token:${REDACTED_VALUE}`);
    });

    it('redacts api_key=<value> embedded mid-query-string', () => {
      const output = sanitizeString(`?foo=1&api_key=${TOKEN}&bar=2`);
      expect(output).not.toContain(TOKEN);
      expect(output).toContain(`api_key=${REDACTED_VALUE}`);
      // Adjacent benign params are preserved.
      expect(output).toContain('foo=1');
      expect(output).toContain('bar=2');
    });
  });

  describe('whitespace-separated forms still redact (no regression)', () => {
    it('redacts "token: <value>"', () => {
      expect(sanitizeString(`token: ${TOKEN}`)).toBe(
        `token: ${REDACTED_VALUE}`,
      );
    });

    it('redacts "Bearer <value>"', () => {
      expect(sanitizeString(`Bearer ${TOKEN}`)).toBe(
        `Bearer ${REDACTED_VALUE}`,
      );
    });

    it('redacts "api_key = <value>"', () => {
      expect(sanitizeString(`api_key = ${TOKEN}`)).toBe(
        `api_key = ${REDACTED_VALUE}`,
      );
    });
  });

  describe('does not over-redact benign content', () => {
    it('leaves non-sensitive key=value pairs untouched', () => {
      expect(sanitizeString('a=b in normal prose')).toBe('a=b in normal prose');
      expect(sanitizeString('price=100 and count=5')).toBe(
        'price=100 and count=5',
      );
    });

    it('leaves short sensitive-key values untouched (below 8-char threshold)', () => {
      expect(sanitizeString('token=null')).toBe('token=null');
      expect(sanitizeString('secret=none')).toBe('secret=none');
    });

    it('does not match a sensitive label embedded in a larger word', () => {
      expect(sanitizeString(`mytokenvalue=${TOKEN}`)).toContain(TOKEN);
    });
  });
});

describe('sanitize on HttpErrorResponse-like records', () => {
  it('redacts a token leaked through a plain record url/message field', () => {
    // Angular HttpErrorResponse is not an Error subclass; sanitize() treats it
    // as a plain record and string-sanitizes its own enumerable fields.
    const errLike = {
      url: `https://x/api/unsubscribe-preferences?token=${TOKEN}`,
      message: `Http failure response for https://x/api/unsubscribe-preferences?token=${TOKEN}: 0 Unknown Error`,
      status: 0,
    };
    const sanitized = sanitize(errLike);
    expect(sanitized.url).not.toContain(TOKEN);
    expect(sanitized.message).not.toContain(TOKEN);
    expect(sanitized.url).toContain(`token=${REDACTED_VALUE}`);
    expect(sanitized.status).toBe(0);
  });
});
