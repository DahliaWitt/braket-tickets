import {describe, expect, it} from 'vitest';
import {validateISODate} from './validation';

describe('validateISODate', () => {
  it('accepts full ISO 8601 UTC timestamps', () => {
    expect(() => validateISODate('2030-12-15T20:00:00.000Z')).not.toThrow();
  });

  it('rejects date-only strings', () => {
    expect(() => validateISODate('2030-12-15')).toThrow(
      'Invalid date: must be a valid ISO 8601 UTC date string',
    );
  });

  it('rejects partial ISO strings', () => {
    expect(() => validateISODate('2030-12')).toThrow(
      'Invalid date: must be a valid ISO 8601 UTC date string',
    );
  });
});
