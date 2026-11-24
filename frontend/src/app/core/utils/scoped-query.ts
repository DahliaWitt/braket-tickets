import {computed, effect, signal, untracked, type Signal} from '@angular/core';
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
 * a live `onSuccess` response (warm-cache or SSR-transferred values remain
 * masked until the subscription delivers a live result).
 *
 * **Scope invariant:** `scope` must be derived from a Convex-synced identity
 * signal (such as `auth.user()?._id`), not a pre-reauth session signal. On
 * `refetch()`, `ConvexClient` replays any warm entry still in
 * `OptimisticQueryResults` via `onUpdate` one macrotask later; using a
 * Convex-synced scope guarantees the re-auth transition has already refreshed
 * the client cache for the new identity before `scope` flips.
 *
 * `options.onSuccess` and `options.onError` are only invoked for settled
 * responses belonging to the active subscription and refetch generation
 * (dropped settles after logout, stale pre-flush pushes, or settles superseded
 * by a queued `triggerRefresh` are suppressed).
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

  let lastSubscribedArgsKey: string | null = null;
  let lastSubscribedRefetchGen = 0;
  let requestedRefetchGen = 0;
  let subscribedKey: string | null = null;
  let subscribedRefetchGen = 0;

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

  const requestRefetch = (): void => {
    requestedRefetchGen += 1;
    rawQuery.refetch();
  };

  const onSettled = (outcome: 'success' | 'error'): boolean => {
    const currentKey = activeKey();
    // Do not wipe settled keys here when currentKey is null: a brief
    // u1 -> null -> u1 transition before effects flush keeps the original
    // subscription open, and the effect clears state if the skip persists.
    if (
      currentKey === null ||
      subscribedKey !== currentKey ||
      subscribedRefetchGen !== requestedRefetchGen
    ) {
      return false;
    }

    if (pendingRefetch()) {
      pendingRefetch.set(false);
      requestRefetch();
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

  const rawQuery = injectQuery(
    query,
    () => {
      const args = effectiveArgs();
      if (args === skipToken) {
        lastSubscribedArgsKey = null;
        subscribedKey = null;
        return skipToken;
      }

      const argsKey = JSON.stringify(convexToJson(args));
      const currentScope = untracked(scope);
      // Mirror convex-angular 1.11's `${refetchVersion}:${argsKey}` dedupe
      // check so subscribedKey only advances when injectQuery actually opens a
      // fresh subscription (first subscribe, args changed, or requested
      // refetch). Re-verify this mirror on convex-angular upgrades.
      if (
        argsKey !== lastSubscribedArgsKey ||
        requestedRefetchGen !== lastSubscribedRefetchGen
      ) {
        lastSubscribedArgsKey = argsKey;
        lastSubscribedRefetchGen = requestedRefetchGen;
        subscribedKey =
          currentScope === null ? null : `${currentScope}:${argsKey}`;
        subscribedRefetchGen = requestedRefetchGen;
      }

      return args;
    },
    {
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
    },
  );

  let previousKey: string | null | undefined;

  effect(
    () => {
      const currentKey = activeKey();
      const prevKey = previousKey;
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
        settledSuccessKey.set(null);
        settledErrorKey.set(null);
      }

      if (subscribedKey !== currentKey) {
        settledSuccessKey.set(null);
        settledErrorKey.set(null);
        requestRefetch();
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
    requestRefetch();
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
    refetch: requestRefetch,
    triggerRefresh,
  };
}
