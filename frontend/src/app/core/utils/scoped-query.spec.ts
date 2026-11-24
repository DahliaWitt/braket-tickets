import {
  Injectable,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {CONVEX} from 'convex-angular';
import {api} from '@convex/_generated/api';
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

  function createHarness(initialScope: string | null = 'u1') {
    const scope = signal<string | null>(initialScope);

    @Injectable()
    class HostService {
      readonly query = injectScopedQuery(
        api.communities.scanners.hasAnyAssignment,
        scope,
        () => ({}),
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

    onData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);

    // Setting the same scope value does not resubscribe or re-mask data.
    scope.set('u1');
    await flushReactiveWork();

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(1);
    expect(query.data()).toBe(true);
  });

  it('refetches and masks prior data on u1 -> u2, stays masked on error, and unmasks on success', async () => {
    const firstUnsubscribe = vi.fn();
    let firstOnData: ((value: unknown) => void) | undefined;
    let secondOnData: ((value: unknown) => void) | undefined;
    let secondOnError: ((err: Error) => void) | undefined;

    // Simulate warm-cache replay still holding u1's value across resubscribe.
    convexMock.client.localQueryResult = vi.fn().mockReturnValue(true);
    convexMock.onUpdate
      .mockImplementationOnce(
        (_query, _args, onData: (value: unknown) => void) => {
          firstOnData = onData;
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

    const {scope, query} = createHarness('u1');
    await flushReactiveWork();

    firstOnData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);

    // Direct account switch u1 -> u2 without passing through null.
    scope.set('u2');
    expect(query.data()).toBeUndefined();
    await flushReactiveWork();

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(2);
    expect(query.data()).toBeUndefined();

    // First response for u2 errors: prior-account data stays masked.
    secondOnError?.(new Error('transient reauth failure'));
    await flushReactiveWork();
    expect(query.data()).toBeUndefined();
    expect(query.error()).toBeInstanceOf(Error);

    // Subsequent success for u2 unmasks u2's result.
    secondOnData?.(false);
    await flushReactiveWork();
    expect(query.data()).toBe(false);
    expect(query.error()).toBeUndefined();
  });

  it('clears data and unsubscribes on logout (scope -> null)', async () => {
    const unsubscribe = vi.fn();
    let onData: ((value: unknown) => void) | undefined;

    convexMock.onUpdate.mockImplementationOnce(
      (_query, _args, callback: (value: unknown) => void) => {
        onData = callback;
        return unsubscribe;
      },
    );
    convexMock.client.onUpdate = convexMock.onUpdate;

    const {scope, query} = createHarness('u1');
    await flushReactiveWork();

    onData?.(true);
    await flushReactiveWork();
    expect(query.data()).toBe(true);

    scope.set(null);
    await flushReactiveWork();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(query.data()).toBeUndefined();
    expect(query.isSkipped()).toBe(true);
  });

  it('masks on triggerRefresh, defers while loading, and unmasks when settled', async () => {
    const firstUnsubscribe = vi.fn();
    let firstOnData: ((value: unknown) => void) | undefined;
    let secondOnData: ((value: unknown) => void) | undefined;

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
          return vi.fn();
        },
      );
    convexMock.client.onUpdate = convexMock.onUpdate;

    const {query} = createHarness('u1');
    await flushReactiveWork();

    // Active query is still loading; triggerRefresh defers the refetch.
    query.triggerRefresh();
    await flushReactiveWork();

    expect(convexMock.onUpdate).toHaveBeenCalledTimes(1);
    expect(query.data()).toBeUndefined();

    // First response settles -> queued refetch fires immediately while data stays masked.
    firstOnData?.(true);
    await flushReactiveWork();

    expect(firstUnsubscribe).toHaveBeenCalledTimes(1);
    expect(convexMock.onUpdate).toHaveBeenCalledTimes(2);
    expect(query.data()).toBeUndefined();

    // Refetched response settles -> data unmasks.
    secondOnData?.(false);
    await flushReactiveWork();
    expect(query.data()).toBe(false);
  });
});
