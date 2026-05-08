import {describe, expect, it} from 'vitest';
import {
  functionReferenceMatches,
  getFunctionReferenceName,
} from './convex-reference-matchers';

const QUERY_NAME_SYMBOL = Symbol.for('functionName');

describe('getFunctionReferenceName', () => {
  it('returns the string for string references', () => {
    expect(getFunctionReferenceName('events:list')).toBe('events:list');
  });

  it('returns the function name for function references', () => {
    function myQuery() {
      return;
    }
    expect(getFunctionReferenceName(myQuery)).toBe('myQuery');
  });

  it('returns null for anonymous functions', () => {
    expect(getFunctionReferenceName(() => undefined)).toBeNull();
  });

  it('returns the symbol value for objects with QUERY_NAME_SYMBOL', () => {
    const ref = {[QUERY_NAME_SYMBOL]: 'events:analytics:getRecentCheckIns'};
    expect(getFunctionReferenceName(ref)).toBe(
      'events:analytics:getRecentCheckIns',
    );
  });

  it('returns the .name property for objects without the symbol', () => {
    const ref = {name: 'events:list'};
    expect(getFunctionReferenceName(ref)).toBe('events:list');
  });

  it('prefers symbol over .name when both are present', () => {
    const ref = {[QUERY_NAME_SYMBOL]: 'symbol:name', name: 'dot-name'};
    expect(getFunctionReferenceName(ref)).toBe('symbol:name');
  });

  it('returns the .path property for objects without symbol or .name', () => {
    const ref = {path: 'events/management/adminList'};
    expect(getFunctionReferenceName(ref)).toBe('events/management/adminList');
  });

  it('prefers .name over .path when both are present', () => {
    const ref = {name: 'dot-name', path: 'path-value'};
    expect(getFunctionReferenceName(ref)).toBe('dot-name');
  });

  it('returns null for objects with no recognizable name', () => {
    expect(getFunctionReferenceName({})).toBeNull();
    expect(getFunctionReferenceName({other: 'value'})).toBeNull();
  });

  it('returns null for null', () => {
    expect(getFunctionReferenceName(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(getFunctionReferenceName(undefined)).toBeNull();
  });

  it('returns null for numbers', () => {
    expect(getFunctionReferenceName(42)).toBeNull();
  });

  it('returns null for booleans', () => {
    expect(getFunctionReferenceName(true)).toBeNull();
  });

  it('ignores non-string symbol values', () => {
    const ref = {[QUERY_NAME_SYMBOL]: 123};
    expect(getFunctionReferenceName(ref)).toBeNull();
  });

  it('ignores non-string .name values', () => {
    const ref = {name: 456};
    expect(getFunctionReferenceName(ref)).toBeNull();
  });

  it('ignores non-string .path values', () => {
    const ref = {path: true};
    expect(getFunctionReferenceName(ref)).toBeNull();
  });
});

describe('functionReferenceMatches', () => {
  it('returns true for identical object references (identity short-circuit)', () => {
    const ref = {[QUERY_NAME_SYMBOL]: 'events:list'};
    expect(functionReferenceMatches(ref, ref)).toBe(true);
  });

  it('returns true when both references have the same name', () => {
    const a = {[QUERY_NAME_SYMBOL]: 'events:list'};
    const b = {[QUERY_NAME_SYMBOL]: 'events:list'};
    expect(functionReferenceMatches(a, b)).toBe(true);
  });

  it('returns true when names match across different reference types', () => {
    const stringRef = 'events:list';
    const objectRef = {[QUERY_NAME_SYMBOL]: 'events:list'};
    expect(functionReferenceMatches(stringRef, objectRef)).toBe(true);
  });

  it('returns false when names differ', () => {
    const a = {[QUERY_NAME_SYMBOL]: 'events:list'};
    const b = {[QUERY_NAME_SYMBOL]: 'events:create'};
    expect(functionReferenceMatches(a, b)).toBe(false);
  });

  it('returns false when one reference has no recognizable name', () => {
    const a = {[QUERY_NAME_SYMBOL]: 'events:list'};
    const b = {};
    expect(functionReferenceMatches(a, b)).toBe(false);
  });

  it('returns false when both references have no recognizable name', () => {
    expect(functionReferenceMatches({}, {})).toBe(false);
  });

  it('returns true for identical null references (identity short-circuit)', () => {
    expect(functionReferenceMatches(null, null)).toBe(true);
  });

  it('returns true for identical undefined references (identity short-circuit)', () => {
    expect(functionReferenceMatches(undefined, undefined)).toBe(true);
  });

  it('returns false when comparing a named reference to null', () => {
    const a = {[QUERY_NAME_SYMBOL]: 'events:list'};
    expect(functionReferenceMatches(a, null)).toBe(false);
  });

  it('returns false when comparing a named reference to undefined', () => {
    const a = {[QUERY_NAME_SYMBOL]: 'events:list'};
    expect(functionReferenceMatches(a, undefined)).toBe(false);
  });
});
