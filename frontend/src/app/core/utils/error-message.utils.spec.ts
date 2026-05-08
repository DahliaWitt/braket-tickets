import {ConvexError} from 'convex/values';
import {describe, expect, it} from 'vitest';
import {
  extractConvexErrorMessage,
  extractErrorMessage,
  normalizeRuntimeErrorMessage,
} from './error-message.utils';

describe('error-message utils', () => {
  describe('extractConvexErrorMessage', () => {
    it('returns string ConvexError data', () => {
      expect(
        extractConvexErrorMessage(new ConvexError('Ticket not found')),
      ).toBe('Ticket not found');
    });

    it('returns message from object ConvexError data', () => {
      expect(
        extractConvexErrorMessage(
          new ConvexError({message: 'Choose a later send time'}),
        ),
      ).toBe('Choose a later send time');
    });

    it('returns null for non-Convex errors and unrecognized Convex data', () => {
      expect(extractConvexErrorMessage(new Error('Plain error'))).toBeNull();
      expect(
        extractConvexErrorMessage(new ConvexError({code: 'UNKNOWN'})),
      ).toBeNull();
    });
  });

  describe('normalizeRuntimeErrorMessage', () => {
    it('strips Convex runtime wrappers', () => {
      expect(
        normalizeRuntimeErrorMessage(
          'Server Error\n\n[CONVEX M(users/profile:update)] Uncaught ConvexError: Name exceeds maximum length\n    at handler',
        ),
      ).toBe('Name exceeds maximum length');
    });

    it('strips generic runtime wrappers', () => {
      expect(
        normalizeRuntimeErrorMessage(
          '[CONVEX A(events:create)] Uncaught Error: Upload failed\n    at handler',
        ),
      ).toBe('Upload failed');
    });
  });

  describe('extractErrorMessage', () => {
    it('extracts normalized messages from Convex and standard errors', () => {
      expect(
        extractErrorMessage(
          new ConvexError({
            message: 'Uncaught ConvexError: Inner message\n    at handler',
          }),
        ),
      ).toBe('Inner message');

      expect(
        extractErrorMessage(new Error('Uncaught Error: Plain failure')),
      ).toBe('Plain failure');
    });

    it('returns an empty message for ConvexError data without a user message', () => {
      expect(extractErrorMessage(new ConvexError({code: 'UNKNOWN'}))).toBe('');
    });

    it('unwraps Angular rejection-wrapped errors', () => {
      const wrapped = {rejection: new Error('Chunk load failed')};
      expect(extractErrorMessage(wrapped)).toBe('Chunk load failed');
    });

    it('recursively unwraps deeply nested rejections', () => {
      const deeplyWrapped = {
        rejection: {rejection: new Error('Deep failure')},
      };
      expect(extractErrorMessage(deeplyWrapped)).toBe('Deep failure');
    });

    it('handles circular rejection references without stack overflow', () => {
      const a: {rejection?: unknown; message?: string} = {};
      const b: {rejection?: unknown; message?: string} = {};
      a.rejection = b;
      b.rejection = a;
      // Should not throw; falls through to String() after depth guard
      expect(extractErrorMessage(a)).toBe('[object Object]');
    });

    it('extracts message from objects with a .message property that are not Error instances', () => {
      expect(extractErrorMessage({message: 'Object message'})).toBe(
        'Object message',
      );
    });

    it('normalizes runtime prefixes from object .message', () => {
      expect(
        extractErrorMessage({message: 'Uncaught Error: Something broke'}),
      ).toBe('Something broke');
    });

    it('handles string errors', () => {
      expect(extractErrorMessage('plain string error')).toBe(
        'plain string error',
      );
    });

    it('normalizes runtime prefixes from string errors', () => {
      expect(extractErrorMessage('Uncaught Error: String failure')).toBe(
        'String failure',
      );
    });

    it('unwraps ConvexError inside a rejection', () => {
      const wrapped = {
        rejection: new ConvexError({
          message: 'Uncaught ConvexError: Ticket not found\n    at handler',
        }),
      };
      expect(extractErrorMessage(wrapped)).toBe('Ticket not found');
    });

    it('falls back to String() for non-string, non-object, non-Error values', () => {
      expect(extractErrorMessage(42)).toBe('42');
    });
  });
});
