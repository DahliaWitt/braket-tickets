/**
 * Test utilities for matching Convex function references by name.
 *
 * Convex query/mutation references can be represented as objects (with
 * `Symbol.for('functionName')`, `.name`, or `.path`), strings, or functions.
 * This module extracts a comparable name from any representation.
 *
 * Usage in specs:
 *   import {functionReferenceMatches, getFunctionReferenceName} from '@/testing/convex-reference-matchers';
 *   queryMock.mockImplementation((ref) => {
 *     if (functionReferenceMatches(ref, api.events.list)) { ... }
 *   });
 */

const QUERY_NAME_SYMBOL = Symbol.for('functionName');

/**
 * Extracts a comparable string name from a Convex function reference.
 *
 * Returns `null` for unrecognized shapes.
 */
export function getFunctionReferenceName(reference: unknown): string | null {
  if (typeof reference === 'string') {
    return reference;
  }

  if (typeof reference === 'function') {
    return reference.name || null;
  }

  if (reference && typeof reference === 'object') {
    const candidate = reference as Record<string | symbol, unknown>;

    const symbolValue = candidate[QUERY_NAME_SYMBOL];
    if (typeof symbolValue === 'string') {
      return symbolValue;
    }

    if (typeof candidate.name === 'string') {
      return candidate.name;
    }

    if (typeof candidate.path === 'string') {
      return candidate.path;
    }
  }

  return null;
}

/**
 * Tests whether two Convex function references refer to the same function.
 *
 * Short-circuits on identity (`===`) for efficiency, then falls back to
 * name comparison.
 */
export function functionReferenceMatches(
  reference: unknown,
  target: unknown,
): boolean {
  if (reference === target) {
    return true;
  }

  const referenceName = getFunctionReferenceName(reference);
  const targetName = getFunctionReferenceName(target);
  return Boolean(referenceName && targetName && referenceName === targetName);
}
