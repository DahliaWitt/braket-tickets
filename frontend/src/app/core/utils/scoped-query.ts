import {computed, effect, signal, type Signal} from '@angular/core';
import {
  injectQuery,
  skipToken,
  type QueryOptions,
  type QueryReference,
  type QueryResult,
  type QueryStatus,
  type SkipToken,
} from 'convex-angular';
import {type FunctionArgs, type FunctionReturnType} from 'convex/server';
import {convexToJson} from 'convex/values';

export type ScopedQueryOptions<Query extends QueryReference> = Omit<
  QueryOptions<Query>,
  'placeholderData'
>;

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
 * forces a resubscribe and masks `data()`, `error()`, and status signals until
 * a response arrives for the new `(scope, args)` pair. `data()` only unmasks on
 * a successful response.
 *
 * **Scope invariant:** `scope` must be derived from a Convex-synced identity
 * signal (such as `auth.user()?._id`), not a pre-reauth session signal. On
 * `refetch()`, `ConvexClient` replays any warm entry still in
 * `OptimisticQueryResults` via `onUpdate` one macrotask later; using a
 * Convex-synced scope guarantees the re-auth transition has already refreshed
 * the client cache for the new identity before `scope` flips.
 *
 * `options.onSuccess` and `options.onError` are only invoked for settled
 * responses that apply to the active query (dropped settles after logout or
 * superseded by a queued `triggerRefresh` are suppressed).
 */
export function injectScopedQuery<Query extends QueryReference>(
  query: Query,
  scope: Signal<string | null>,
  argsFn: () => FunctionArgs<Query> | SkipToken,
  options?: ScopedQueryOptions<Query>,
): ScopedQueryResult<Query> {
  const refreshMaskActive = signal(false);
  const pendingRefetch = signal(false);
  const settledSuccessKey = signal<string | null>(null);
  const settledErrorKey = signal<string | null>(null);

  const effectiveArgs = computed<FunctionArgs<Query> | SkipToken>(() =>
    scope() === null ? skipToken : argsFn(),
  );

  const activeKey = computed<string | null>(() => {
    const currentScope = scope();
    const args = effectiveArgs();
    if (currentScope === null || args === skipToken) {
      return null;
    }

    return `${currentScope}:${JSON.stringify(convexToJson(args))}`;
  });

  const onSettled = (outcome: 'success' | 'error'): boolean => {
    const currentKey = activeKey();
    if (currentKey === null) {
      pendingRefetch.set(false);
      refreshMaskActive.set(false);
      settledSuccessKey.set(null);
      settledErrorKey.set(null);
      return false;
    }

    if (pendingRefetch()) {
      pendingRefetch.set(false);
      rawQuery.refetch();
      return false;
    }

    refreshMaskActive.set(false);
    // Only mark the current key visible after a successful response.
    // injectQuery retains prior data on error, so unmasking on error after an
    // account switch would expose the previous account's data.
    if (outcome === 'success') {
      settledSuccessKey.set(currentKey);
      settledErrorKey.set(null);
    } else {
      settledErrorKey.set(currentKey);
    }
    return true;
  };

  const rawQuery = injectQuery(query, effectiveArgs, {
    ...options,
    onSuccess: (result) => {
      if (onSettled('success')) {
        options?.onSuccess?.(result);
      }
    },
    onError: (err) => {
      if (onSettled('error')) {
        options?.onError?.(err);
      }
    },
  });

  let previousScope: string | null | undefined;
  let previousKey: string | null | undefined;

  effect(
    () => {
      const currentScope = scope();
      const currentKey = activeKey();
      const prevScope = previousScope;
      const prevKey = previousKey;
      previousScope = currentScope;
      previousKey = currentKey;

      if (currentKey === null) {
        pendingRefetch.set(false);
        refreshMaskActive.set(false);
        settledSuccessKey.set(null);
        settledErrorKey.set(null);
        return;
      }

      if (prevKey !== undefined && prevKey !== currentKey) {
        pendingRefetch.set(false);
        refreshMaskActive.set(false);
      }

      if (
        prevScope !== undefined &&
        prevScope !== null &&
        prevScope !== currentScope
      ) {
        settledSuccessKey.set(null);
        settledErrorKey.set(null);
        rawQuery.refetch();
      }
    },
    options?.injectRef ? {injector: options.injectRef} : undefined,
  );

  const triggerRefresh = (): void => {
    if (activeKey() === null) {
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

  const isSkipped = computed(() => activeKey() === null);

  const isDataVisible = computed(() => {
    const key = activeKey();
    return key !== null && !refreshMaskActive() && settledSuccessKey() === key;
  });

  const isErrorVisible = computed(() => {
    const key = activeKey();
    return key !== null && !refreshMaskActive() && settledErrorKey() === key;
  });

  const data = computed<FunctionReturnType<Query> | undefined>(() => {
    if (!isDataVisible()) {
      return undefined;
    }

    return rawQuery.data();
  });

  const error = computed<Error | undefined>(() => {
    if (!isErrorVisible()) {
      return undefined;
    }

    return rawQuery.error();
  });

  const isLoading = computed(() => {
    if (isSkipped()) {
      return false;
    }

    if (refreshMaskActive() || (!isDataVisible() && !isErrorVisible())) {
      return true;
    }

    return rawQuery.isLoading();
  });

  const isSuccess = computed(
    () => !isSkipped() && !isLoading() && !error() && isDataVisible(),
  );

  const isRefetching = computed(() => isLoading() && data() !== undefined);

  const status = computed<QueryStatus>(() => {
    if (isSkipped()) {
      return 'skipped';
    }
    if (isLoading()) {
      return 'pending';
    }
    if (error()) {
      return 'error';
    }
    return 'success';
  });

  return {
    ...rawQuery,
    data,
    error,
    isLoading,
    isRefetching,
    isSkipped,
    isSuccess,
    status,
    triggerRefresh,
  };
}
