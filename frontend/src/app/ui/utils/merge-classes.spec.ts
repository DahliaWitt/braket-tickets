import { generateId } from './merge-classes';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('merge-classes utils', () => {
  describe('generateId', () => {
    it('should generate a valid UUID v4 string', () => {
      const id = generateId();
      expect(id).toMatch(UUID_REGEX);
    });

    it('should append prefix if provided', () => {
      const id = generateId('test');
      expect(id.startsWith('test-')).toBe(true);
      const uuid = id.slice('test-'.length);
      expect(uuid).toMatch(UUID_REGEX);
    });

    it('should use crypto.getRandomValues when randomUUID is unavailable', () => {
      const originalCrypto = globalThis.crypto;

      // Provide crypto with getRandomValues but NOT randomUUID
      Object.defineProperty(globalThis, 'crypto', {
        value: {
          getRandomValues: (arr: Uint8Array) => {
            (originalCrypto.getRandomValues as (arr: Uint8Array) => void)(arr);
          },
        },
        writable: true,
        configurable: true,
      });

      const id = generateId('tier2');
      expect(id.startsWith('tier2-')).toBe(true);
      const uuid = id.slice('tier2-'.length);
      expect(uuid).toMatch(UUID_REGEX);

      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        writable: true,
        configurable: true,
      });
    });

    it('should use Math.random fallback when crypto is unavailable', () => {
      const originalCrypto = globalThis.crypto;

      Object.defineProperty(globalThis, 'crypto', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      const id = generateId('tier3');
      expect(id.startsWith('tier3-')).toBe(true);
      // Math.random fallback still produces UUID-shaped strings
      expect(id.split('-').length).toBe(6); // prefix + 5 UUID segments

      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        writable: true,
        configurable: true,
      });
    });
  });
});
