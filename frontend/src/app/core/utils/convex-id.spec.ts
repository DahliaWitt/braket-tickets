import { describe, it, expect } from 'vitest';
import { isConvexId } from './convex-id';

describe('isConvexId', () => {
  it('returns true for a valid 32-character lowercase alphanumeric string', () => {
    expect(isConvexId('kg7q8j7m2pzk4w3r9n5s2f8h1c6b3a0d')).toBe(true);
  });

  it('returns false for a non-ID string', () => {
    expect(isConvexId('NOT-AN-ID')).toBe(false);
  });

  it('returns false for a 31-character string', () => {
    expect(isConvexId('kg7q8j7m2pzk4w3r9n5s2f8h1c6b3a0')).toBe(false);
  });

  it('returns false for an uppercase string', () => {
    expect(isConvexId('KG7Q8J7M2PZK4W3R9N5S2F8H1C6B3A0D')).toBe(false);
  });

  it('returns false for a 33-character string', () => {
    expect(isConvexId('kg7q8j7m2pzk4w3r9n5s2f8h1c6b3a0de')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isConvexId(undefined)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isConvexId(null)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isConvexId('')).toBe(false);
  });
});
