import {
  computed,
  effect,
  linkedSignal,
  signal,
  type Signal,
} from '@angular/core';
import {
  injectQuery,
  skipToken,
  type QueryOptions,
  type QueryReference,
  type QueryResult,
  type SkipToken,
} from 'convex-angular';
import {type FunctionArgs, type FunctionReturnType} from 'convex/server';

export interface ScopedQueryResult<
  Query extends QueryReference,
> extends QueryResult<Query> {
  /**
   * Masks data and refetches immediately when idle, or queues a refetch once
   * the active in-flight query settles.
   */
  readonly triggerRefresh: () => void;
}

/**
 * Wraps `injectQuery` for user-scoped queries whose serialized args do not
 * encode the active user (identity is derived server-side from auth).
 *
 * `convex-angular` 1.11 skips resubscribing when serialized args are unchanged
 * and retains prior `data()` on error. When `scope` changes from one non-null
 * value to another (for example, direct account switch `u1 -> u2`), this helper
 * forces a resubscribe and masks `data()` until a successful response arrives
 * for the new scope.
 */
export function injectScopedQuery<Query extends QueryReference>(
  query: Query,
  scope: Signal<string | null>,
  argsFn: () => FunctionArgs<Query> | SkipToken,
  options?: QueryOptions<Query>,
): ScopedQueryResult<Query> {
  const refreshMaskActive = signal(false);
  const pendingRefetch = signal(false);

  const visibleScope = linkedSignal<string | null, string | null>({
    source: scope,
    computation: (currentScope, previous) => {
      if (currentScope === null) {
        return null;
      }

      return previous?.source === currentScope ? previous.value : null;
    },
  });

  const shouldHideData = computed(() => {
    const currentScope = scope();
    return (
      currentScope !== null &&
      (refreshMaskActive() || visibleScope() !== currentScope)
    );
  });

  const onSettled = (outcome: 'success' | 'error'): void => {
    const currentScope = scope();
    if (currentScope === null) {
      pendingRefetch.set(false);
      refreshMaskActive.set(false);
      visibleScope.set(null);
      return;
    }

    if (pendingRefetch()) {
      pendingRefetch.set(false);
      rawQuery.refetch();
      return;
    }

    refreshMaskActive.set(false);
    // Only mark the current scope visible after a successful response.
    // injectQuery retains prior data on error, so unmasking on error after an
    // account switch would expose the previous account's data.
    if (outcome === 'success') {
      visibleScope.set(currentScope);
    }
  };

  const rawQuery = injectQuery(
    query,
    () => (scope() === null ? skipToken : argsFn()),
    {
      ...options,
      onSuccess: (result) => {
        onSettled('success');
        options?.onSuccess?.(result);
      },
      onError: (err) => {
        onSettled('error');
        options?.onError?.(err);
      },
    },
  );

  let previousScope = scope();

  effect(() => {
    const currentScope = scope();
    const prev = previousScope;
    previousScope = currentScope;

    if (currentScope === null) {
      pendingRefetch.set(false);
      refreshMaskActive.set(false);
      return;
    }

    if (prev !== null && prev !== currentScope) {
      pendingRefetch.set(false);
      rawQuery.refetch();
    }
  });

  const triggerRefresh = (): void => {
    if (scope() === null) {
      return;
    }

    refreshMaskActive.set(true);
    if (rawQuery.isLoading()) {
      pendingRefetch.set(true);
      return;
    }

    pendingRefetch.set(false);
    rawQuery.refetch();
  };

  const data = computed<FunctionReturnType<Query> | undefined>(() => {
    if (scope() === null || shouldHideData()) {
      return undefined;
    }

    return rawQuery.data();
  });

  return {
    ...rawQuery,
    data,
    triggerRefresh,
  };
}
