import {
  EnvironmentInjector,
  Injectable,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {CONVEX, skipToken} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {injectScopedQuery} from './scoped-query';

describe('injectScopedQuery', () => {
  let convexMock: MockConvexClient;

  const flushReactiveWork = async (): Promise<void> => {
    TestBed.tick();
    await Promise.resolve();
  };

  beforeEach(() => {
    convexMock = createMockConvexClient();
    TestBed.resetTestingModule();
  });

  function createHarness(
    initialScope: string | null = 'u1',
    options?: {
      onSuccess?: (result: boolean) => void;
      onError?: (err: Error) => void;
    },
  ) {
    const scope = signal<string | null>(initialScope);

    @Injectable()
    class HostService {
      readonly query = injectScopedQuery(
        api.communities.scanners.hasAnyAssignment,
        scope,
        () => ({}),
        options,
      );
    }

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        HostService,
        {provide: CONVEX, useValue: convexMock},
      ],
    });

    const host = TestBed.inject(HostService);
    return {scope, query: host.query};
  }

  it('is a no-op when scope stays the same', async () => {
    let onData: ((value: unknown) => void) | undefined;
    const unsubscribe = vi.fn();

    convexMock.onUpdate.mockImplementationOnce(
      (_query, _args, callback: (value: unknown) => void) => {
        onData = callback;
        return unsubscribe;
      },
    );
    convexMock.client.onUpdate = convexMock.onUpdate;

    const {scope, query} = createHarness('u1');
    await flushReactiveWork();

    expect(convexMock.onUpdate).toHaveBeenCalledTimes(1);
    expect(query.data()).toBeUndefined();
    expect(query.isLoading()).toBe(true);
    expect(query.status()).toBe('pending');

    onData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);
    expect(query.isSuccess()).toBe(true);
    expect(query.status()).toBe('success');

    scope.set('u1');
    await flushReactiveWork();

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(1);
    expect(query.data()).toBe(true);
  });

  it('refetches and masks data, error, and status on u1 -> u2, stays masked on error, and unmasks on success', async () => {
    const firstUnsubscribe = vi.fn();
    let firstOnData: ((value: unknown) => void) | undefined;
    let firstOnError: ((err: Error) => void) | undefined;
    let secondOnData: ((value: unknown) => void) | undefined;
    let secondOnError: ((err: Error) => void) | undefined;

    convexMock.client.localQueryResult = vi.fn().mockReturnValue(true);
    convexMock.onUpdate
      .mockImplementationOnce(
        (
          _query,
          _args,
          onData: (value: unknown) => void,
          onError?: (err: Error) => void,
        ) => {
          firstOnData = onData;
          firstOnError = onError;
          return firstUnsubscribe;
        },
      )
      .mockImplementationOnce(
        (
          _query,
          _args,
          onData: (value: unknown) => void,
          onError?: (err: Error) => void,
        ) => {
          secondOnData = onData;
          secondOnError = onError;
          return vi.fn();
        },
      );
    convexMock.client.onUpdate = convexMock.onUpdate;

    const onSuccess = vi.fn();
    const onError = vi.fn();
    const {scope, query} = createHarness('u1', {onSuccess, onError});
    await flushReactiveWork();

    firstOnData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith(true);

    // u1 receives an error before switching; u2 must not inherit u1's error.
    firstOnError?.(new Error('u1 error'));
    await flushReactiveWork();
    expect(query.error()?.message).toBe('u1 error');

    // Direct account switch u1 -> u2 without passing through null.
    scope.set('u2');
    expect(query.data()).toBeUndefined();
    expect(query.error()).toBeUndefined();
    expect(query.isLoading()).toBe(true);
    expect(query.isRefetching()).toBe(false);
    expect(query.isSuccess()).toBe(false);
    expect(query.status()).toBe('pending');
    await flushReactiveWork();

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(2);
    expect(query.data()).toBeUndefined();
    expect(query.error()).toBeUndefined();

    // First response for u2 errors: u2's own error is exposed, prior data stays masked.
    secondOnError?.(new Error('transient reauth failure'));
    await flushReactiveWork();
    expect(query.data()).toBeUndefined();
    expect(query.error()?.message).toBe('transient reauth failure');
    expect(query.isLoading()).toBe(false);
    expect(query.status()).toBe('error');
    expect(query.isSuccess()).toBe(false);
    expect(onError).toHaveBeenLastCalledWith(
      expect.objectContaining({message: 'transient reauth failure'}),
    );

    // Subsequent success for u2 unmasks u2's result.
    secondOnData?.(false);
    await flushReactiveWork();
    expect(query.data()).toBe(false);
    expect(query.error()).toBeUndefined();
    expect(query.isSuccess()).toBe(true);
    expect(query.status()).toBe('success');
  });

  it('drops a late u1 push arriving after scope switches to u2 before effect flush', async () => {
    let firstOnData: ((value: unknown) => void) | undefined;
    let secondOnData: ((value: unknown) => void) | undefined;
    const onSuccess = vi.fn();

    convexMock.onUpdate
      .mockImplementationOnce(
        (_query, _args, onData: (value: unknown) => void) => {
          firstOnData = onData;
          return vi.fn();
        },
      )
      .mockImplementationOnce(
        (_query, _args, onData: (value: unknown) => void) => {
          secondOnData = onData;
          return vi.fn();
        },
      );
    convexMock.client.onUpdate = convexMock.onUpdate;

    const {scope, query} = createHarness('u1', {onSuccess});
    await flushReactiveWork();

    firstOnData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    // Switch scope and deliver a late push on u1's still-open subscription before tick.
    scope.set('u2');
    firstOnData?.(true);
    // Synchronously masked before effect flush and stale callback suppressed.
    expect(query.data()).toBeUndefined();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    await flushReactiveWork();

    expect(convexMock.onUpdate).toHaveBeenCalledTimes(2);
    expect(query.data()).toBeUndefined();
    expect(query.isLoading()).toBe(true);

    secondOnData?.(false);
    await flushReactiveWork();
    expect(query.data()).toBe(false);
    expect(onSuccess).toHaveBeenCalledTimes(2);
  });

  it('drops a late pre-refresh push before effect flush on idle triggerRefresh', async () => {
    let firstOnData: ((value: unknown) => void) | undefined;
    let secondOnData: ((value: unknown) => void) | undefined;
    const onSuccess = vi.fn();

    convexMock.onUpdate
      .mockImplementationOnce(
        (_query, _args, onData: (value: unknown) => void) => {
          firstOnData = onData;
          return vi.fn();
        },
      )
      .mockImplementationOnce(
        (_query, _args, onData: (value: unknown) => void) => {
          secondOnData = onData;
          return vi.fn();
        },
      );
    convexMock.client.onUpdate = convexMock.onUpdate;

    const {query} = createHarness('u1', {onSuccess});
    await flushReactiveWork();

    firstOnData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    // Idle triggerRefresh queues a new refetch generation; a push from the
    // still-open pre-refresh subscription before flush must stay masked.
    query.triggerRefresh();
    firstOnData?.(true);
    expect(query.data()).toBeUndefined();
    expect(query.isLoading()).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    await flushReactiveWork();

    expect(convexMock.onUpdate).toHaveBeenCalledTimes(2);
    expect(query.data()).toBeUndefined();

    secondOnData?.(false);
    await flushReactiveWork();
    expect(query.data()).toBe(false);
    expect(onSuccess).toHaveBeenCalledTimes(2);
  });

  it('does not wedge data on rapid u1 -> u2 -> u1 or u1 -> null -> u1 before effect flush', async () => {
    let onData: ((value: unknown) => void) | undefined;

    convexMock.onUpdate.mockImplementationOnce(
      (_query, _args, callback: (value: unknown) => void) => {
        onData = callback;
        return vi.fn();
      },
    );
    convexMock.client.onUpdate = convexMock.onUpdate;

    const {scope, query} = createHarness('u1');
    await flushReactiveWork();

    onData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);

    scope.set('u2');
    expect(query.data()).toBeUndefined();
    scope.set('u1');
    await flushReactiveWork();
    expect(query.data()).toBe(true);
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(1);

    scope.set(null);
    expect(query.data()).toBeUndefined();
    scope.set('u1');
    await flushReactiveWork();
    expect(query.data()).toBe(true);
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(1);
  });

  it('clears data, unsubscribes, and suppresses late callbacks on logout (scope -> null)', async () => {
    const unsubscribe = vi.fn();
    let onData: ((value: unknown) => void) | undefined;
    const onSuccess = vi.fn();

    convexMock.onUpdate.mockImplementationOnce(
      (_query, _args, callback: (value: unknown) => void) => {
        onData = callback;
        return unsubscribe;
      },
    );
    convexMock.client.onUpdate = convexMock.onUpdate;

    const {scope, query} = createHarness('u1', {onSuccess});
    await flushReactiveWork();

    onData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);

    // triggerRefresh is a no-op when logged out.
    scope.set(null);
    query.triggerRefresh();
    // Late callback arriving after scope -> null is dropped.
    onData?.(true);
    await flushReactiveWork();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(query.data()).toBeUndefined();
    expect(query.isSkipped()).toBe(true);
    expect(query.isLoading()).toBe(false);
    expect(query.status()).toBe('skipped');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('masks on triggerRefresh when idle, defers while loading, and unmasks when settled', async () => {
    const firstUnsubscribe = vi.fn();
    const secondUnsubscribe = vi.fn();
    let firstOnData: ((value: unknown) => void) | undefined;
    let secondOnData: ((value: unknown) => void) | undefined;
    let thirdOnData: ((value: unknown) => void) | undefined;
    const onSuccess = vi.fn();

    convexMock.onUpdate
      .mockImplementationOnce(
        (_query, _args, callback: (value: unknown) => void) => {
          firstOnData = callback;
          return firstUnsubscribe;
        },
      )
      .mockImplementationOnce(
        (_query, _args, callback: (value: unknown) => void) => {
          secondOnData = callback;
          return secondUnsubscribe;
        },
      )
      .mockImplementationOnce(
        (_query, _args, callback: (value: unknown) => void) => {
          thirdOnData = callback;
          return vi.fn();
        },
      );
    convexMock.client.onUpdate = convexMock.onUpdate;

    const {query} = createHarness('u1', {onSuccess});
    await flushReactiveWork();

    // Active query is still loading; triggerRefresh defers the refetch.
    query.triggerRefresh();
    await flushReactiveWork();

    expect(convexMock.onUpdate).toHaveBeenCalledTimes(1);
    expect(query.data()).toBeUndefined();

    // First response settles -> queued refetch fires while data stays masked and onSuccess is suppressed.
    firstOnData?.(true);
    await flushReactiveWork();

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(2);
    expect(query.data()).toBeUndefined();
    expect(onSuccess).not.toHaveBeenCalled();

    // Refetched response settles -> data unmasks.
    secondOnData?.(false);
    await flushReactiveWork();
    expect(query.data()).toBe(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    // triggerRefresh while idle masks and refetches immediately.
    query.triggerRefresh();
    expect(query.data()).toBeUndefined();
    expect(query.isLoading()).toBe(true);
    await flushReactiveWork();

    expect(secondUnsubscribe).toHaveBeenCalledTimes(1);
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(3);

    thirdOnData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);
  });

  it('masks same-scope arg changes, handles skipToken synchronously, and supports injectRef', async () => {
    const scope = signal<string | null>('u1');
    const organizerId = signal<Id<'organizers'> | null>(
      'org1' as Id<'organizers'>,
    );

    let firstOnData: ((value: unknown) => void) | undefined;
    let secondOnData: ((value: unknown) => void) | undefined;
    let secondOnError: ((err: Error) => void) | undefined;

    convexMock.onUpdate
      .mockImplementationOnce(
        (_query, _args, onData: (value: unknown) => void) => {
          firstOnData = onData;
          return vi.fn();
        },
      )
      .mockImplementationOnce(
        (
          _query,
          _args,
          onData: (value: unknown) => void,
          onError?: (err: Error) => void,
        ) => {
          secondOnData = onData;
          secondOnError = onError;
          return vi.fn();
        },
      );
    convexMock.client.onUpdate = convexMock.onUpdate;

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: convexMock},
      ],
    });

    const envInjector = TestBed.inject(EnvironmentInjector);
    const onSuccess = vi.fn();
    const query = injectScopedQuery(
      api.communities.trust_links.checkUserTrust,
      scope,
      () => {
        const id = organizerId();
        return id ? {organizerId: id} : skipToken;
      },
      {injectRef: envInjector, onSuccess},
    );
    await flushReactiveWork();

    firstOnData?.({trusted: true, source: 'direct', via: null});
    await flushReactiveWork();
    expect(query.data()?.trusted).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);

    // Switching organizerId under the same user masks org1's result immediately,
    // and a late push from org1 before effect flush is dropped.
    organizerId.set('org2' as Id<'organizers'>);
    firstOnData?.({trusted: true, source: 'direct', via: null});
    expect(query.data()).toBeUndefined();
    expect(query.isLoading()).toBe(true);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    await flushReactiveWork();
    expect(query.data()).toBeUndefined();

    // Error on org2 must not leak org1's trusted result.
    secondOnError?.(new Error('org2 error'));
    await flushReactiveWork();
    expect(query.data()).toBeUndefined();
    expect(query.error()?.message).toBe('org2 error');

    secondOnData?.({trusted: false, source: null, via: null});
    await flushReactiveWork();
    expect(query.data()?.trusted).toBe(false);
    expect(onSuccess).toHaveBeenCalledTimes(2);

    // Skipping via argsFn while scope is non-null masks synchronously and ignores triggerRefresh.
    organizerId.set(null);
    expect(query.data()).toBeUndefined();
    expect(query.isSkipped()).toBe(true);
    query.triggerRefresh();
    await flushReactiveWork();
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(2);
  });
});
