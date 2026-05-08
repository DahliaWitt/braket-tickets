import type {Resource, Signal} from '@angular/core';

export type AsyncLoadState = 'idle' | 'loading' | 'error' | 'ready';

export interface QueryStateSource<T> {
  data: Signal<T | undefined>;
  error: Signal<Error | undefined>;
  isLoading: Signal<boolean>;
  isSkipped: Signal<boolean>;
}

/**
 * Read an Angular resource value safely from a `computed()`.
 *
 * `resource.value()` throws when the resource is in `'error'` state, which
 * would propagate the loader error into every downstream computed/effect that
 * reads it. `hasValue()` returns `true` only for `'resolved' | 'reloading' |
 * 'local'` — exactly the states where `value()` is safe — so a `hasValue()`
 * gate is sufficient to avoid the throw.
 *
 * Returns the current value when one is available, `undefined` otherwise
 * (loading, idle, error, or reload-after-failure).
 */
export function safeResourceValue<T>(res: Resource<T>): T | undefined {
  return res.hasValue() ? res.value() : undefined;
}

export function queryLoadState<T>(query: QueryStateSource<T>): AsyncLoadState {
  if (query.isSkipped()) return 'idle';
  if (query.isLoading()) return 'loading';
  if (query.error()) return 'error';
  return query.data() === undefined ? 'loading' : 'ready';
}

export function resourceLoadState<T>(res: Resource<T>): AsyncLoadState {
  if (res.error()) return 'error';
  if (res.isLoading()) return 'loading';
  if (res.hasValue()) return 'ready';
  return 'idle';
}
