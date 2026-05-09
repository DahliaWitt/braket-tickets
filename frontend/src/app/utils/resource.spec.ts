import {signal} from '@angular/core';
import type {Resource} from '@angular/core';
import {describe, expect, it, vi} from 'vitest';

import {
  queryLoadState,
  safeResourceValue,
  type QueryStateSource,
} from './resource';

/** Build a minimal `Resource<T>`-shaped mock; extra fields are irrelevant. */
function makeResource<T>(overrides: {
  hasValue?: () => boolean;
  value?: () => T;
  error?: () => Error | undefined;
  isLoading?: () => boolean;
}): Resource<T> {
  return {
    hasValue: overrides.hasValue ?? (() => false),
    value: overrides.value ?? (() => undefined as T),
    error: overrides.error ?? (() => undefined),
    isLoading: overrides.isLoading ?? (() => false),
  } as unknown as Resource<T>;
}

describe('safeResourceValue', () => {
  it('returns the value when the resource has a value', () => {
    const value = vi.fn(() => ({count: 7}));
    const res = makeResource({hasValue: () => true, value});

    expect(safeResourceValue(res)).toEqual({count: 7});
    expect(value).toHaveBeenCalledOnce();
  });

  it('returns undefined when the resource has no value', () => {
    const value = vi.fn(() => {
      throw new Error('value() should not be called');
    });
    const res = makeResource({hasValue: () => false, value});

    expect(safeResourceValue(res)).toBeUndefined();
    expect(value).not.toHaveBeenCalled();
  });

  it('never calls value() in error state (hasValue() is false)', () => {
    // Angular resources return hasValue() === false in 'error' state, so the
    // helper should never reach a value() call that would re-throw.
    const value = vi.fn(() => {
      throw new Error('loader failed');
    });
    const res = makeResource({hasValue: () => false, value});

    expect(() => safeResourceValue(res)).not.toThrow();
    expect(value).not.toHaveBeenCalled();
  });
});

describe('queryLoadState', () => {
  function makeQuery<T>(
    overrides: Partial<{
      data: T | undefined;
      error: Error | undefined;
      isLoading: boolean;
      isSkipped: boolean;
    }> = {},
  ): QueryStateSource<T> {
    return {
      data: signal(overrides.data),
      error: signal(overrides.error),
      isLoading: signal(overrides.isLoading ?? false),
      isSkipped: signal(overrides.isSkipped ?? false),
    };
  }

  it('returns idle for skipped queries', () => {
    expect(queryLoadState(makeQuery({isSkipped: true}))).toBe('idle');
  });

  it('returns loading while the query is loading', () => {
    expect(queryLoadState(makeQuery({isLoading: true}))).toBe('loading');
  });

  it('returns error when the query has an error', () => {
    expect(queryLoadState(makeQuery({error: new Error('failed')}))).toBe(
      'error',
    );
  });

  it('returns ready for null data after a successful query', () => {
    expect(queryLoadState(makeQuery<null>({data: null}))).toBe('ready');
  });

  it('keeps undefined data in loading state', () => {
    expect(queryLoadState(makeQuery({data: undefined}))).toBe('loading');
  });
});
