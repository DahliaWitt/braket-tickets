import '../../../test-setup';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { type ConnectionState } from 'convex/browser';
import {
  makeFunctionReference,
  type PaginationOptions,
  type PaginationResult,
} from 'convex/server';
import { provideZonelessChangeDetection } from '@angular/core';
import {
  CONVEX,
  injectQuery,
  injectPaginatedQuery,
  injectMutation,
  injectAction,
  injectConvexConnectionState,
  injectConvex,
  skipToken,
  type SkipToken,
} from 'convex-angular';

const TEST_QUERY = makeFunctionReference<'query', { id: string }, string>('test/query:get');
const TEST_MUTATION = makeFunctionReference<'mutation', { id: string }, { ok: boolean }>(
  'test/query:mutate',
);
const TEST_ACTION = makeFunctionReference<'action', { id: string }, { done: boolean }>(
  'test/query:run',
);
const TEST_PAGINATED_QUERY = makeFunctionReference<
  'query',
  { filter: string; paginationOpts: PaginationOptions },
  PaginationResult<{ id: string }>
>('test/query:listPaginated');

const DISCONNECTED_CONNECTION_STATE: ConnectionState = {
  hasInflightRequests: false,
  isWebSocketConnected: false,
  timeOfOldestInflightRequest: null,
  hasEverConnected: false,
  connectionCount: 0,
  connectionRetries: 0,
  inflightMutations: 0,
  inflightActions: 0,
};

const CONNECTED_CONNECTION_STATE: ConnectionState = {
  hasInflightRequests: true,
  isWebSocketConnected: true,
  timeOfOldestInflightRequest: new Date('2026-02-23T00:00:00.000Z'),
  hasEverConnected: true,
  connectionCount: 2,
  connectionRetries: 1,
  inflightMutations: 1,
  inflightActions: 0,
};

interface MockConvexProvider {
  client: {
    onUpdate: ReturnType<typeof vi.fn>;
    onPaginatedUpdate_experimental: ReturnType<typeof vi.fn>;
    localQueryResult: ReturnType<typeof vi.fn>;
    connectionState: ReturnType<typeof vi.fn>;
    subscribeToConnectionState: ReturnType<typeof vi.fn>;
  };
  onUpdate: ReturnType<typeof vi.fn>;
  onPaginatedUpdate_experimental: ReturnType<typeof vi.fn>;
  localQueryResult: ReturnType<typeof vi.fn>;
  connectionState: ReturnType<typeof vi.fn>;
  subscribeToConnectionState: ReturnType<typeof vi.fn>;
  mutation: ReturnType<typeof vi.fn>;
  action: ReturnType<typeof vi.fn>;
  handleAuthError: ReturnType<typeof vi.fn>;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-query-host',
  template: '',
})
class QueryHostComponent {
  readonly args = signal<{ id: string } | SkipToken>({ id: 'a' });
  result = injectQuery(TEST_QUERY, () => this.args());
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-paginated-host',
  template: '',
})
class PaginatedHostComponent {
  readonly args = signal<{ filter: string } | SkipToken>({ filter: 'all' });
  result = injectPaginatedQuery(
    TEST_PAGINATED_QUERY,
    () => this.args(),
    {
      initialNumItems: 20,
    },
  );
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-mutation-action-host',
  template: '',
})
class MutationActionHostComponent {
  mutationResult = injectMutation(TEST_MUTATION);
  actionResult = injectAction(TEST_ACTION);
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-connection-host',
  template: '',
})
class ConnectionHostComponent {
  connection = injectConvexConnectionState();
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-client-host',
  template: '',
})
class ClientHostComponent {
  client = injectConvex();
}

describe('convex-angular primitives', () => {
  let mockConvex: MockConvexProvider;

  beforeEach(() => {
    const onUpdate = vi.fn();
    const onPaginatedUpdate = vi.fn();
    const localQueryResult = vi.fn().mockReturnValue(undefined);
    const connectionState = vi.fn().mockReturnValue(DISCONNECTED_CONNECTION_STATE);
    const subscribeToConnectionState = vi.fn().mockImplementation(() => () => void 0);

    mockConvex = {
      client: {
        onUpdate,
        onPaginatedUpdate_experimental: onPaginatedUpdate,
        localQueryResult,
        connectionState,
        subscribeToConnectionState,
      },
      onUpdate,
      onPaginatedUpdate_experimental: onPaginatedUpdate,
      localQueryResult,
      connectionState,
      subscribeToConnectionState,
      mutation: vi.fn(),
      action: vi.fn(),
      handleAuthError: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [
        QueryHostComponent,
        PaginatedHostComponent,
        MutationActionHostComponent,
        ConnectionHostComponent,
        ClientHostComponent,
      ],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CONVEX, useValue: mockConvex as unknown as MockConvexProvider },
      ],
    });
  });

  it('injectQuery subscribes and updates signal data', async () => {
    mockConvex.onUpdate.mockImplementation(
      (_query: typeof TEST_QUERY, args: { id: string }, onData: (value: string) => void) => {
        onData(`value-${args.id}`);
        return () => void 0;
      },
    );

    const fixture: ComponentFixture<QueryHostComponent> =
      TestBed.createComponent(QueryHostComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance.result.status()).toBe('success');
    expect(fixture.componentInstance.result.data()).toBe('value-a');
    expect(mockConvex.onUpdate).toHaveBeenCalledTimes(1);
  });

  it('injectQuery re-subscribes when args change', async () => {
    const unsubA = vi.fn();
    const unsubB = vi.fn();
    mockConvex.onUpdate
      .mockImplementationOnce(
        (_query: typeof TEST_QUERY, args: { id: string }, onData: (value: string) => void) => {
          onData(`value-${args.id}`);
          return unsubA;
        },
      )
      .mockImplementationOnce(
        (_query: typeof TEST_QUERY, args: { id: string }, onData: (value: string) => void) => {
          onData(`value-${args.id}`);
          return unsubB;
        },
      );

    const fixture: ComponentFixture<QueryHostComponent> =
      TestBed.createComponent(QueryHostComponent);
    await fixture.whenStable();

    fixture.componentInstance.args.set({ id: 'b' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(unsubA).toHaveBeenCalledTimes(1);
    expect(mockConvex.onUpdate).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.result.data()).toBe('value-b');
  });

  it('injectQuery supports skipToken', async () => {
    mockConvex.onUpdate.mockImplementation(
      (_query: typeof TEST_QUERY, args: { id: string }, onData: (value: string) => void) => {
        onData(`value-${args.id}`);
        return () => void 0;
      },
    );

    const fixture: ComponentFixture<QueryHostComponent> =
      TestBed.createComponent(QueryHostComponent);
    await fixture.whenStable();

    fixture.componentInstance.args.set(skipToken);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.result.status()).toBe('skipped');
    expect(fixture.componentInstance.result.isSkipped()).toBe(true);
    expect(fixture.componentInstance.result.data()).toBeUndefined();
  });

  it('injectPaginatedQuery tracks results and loadMore', async () => {
    const loadMoreFn = vi.fn().mockReturnValue(true);

    mockConvex.onPaginatedUpdate_experimental.mockImplementation(
      (
        _query: typeof TEST_PAGINATED_QUERY,
        _args: { filter: string },
        _options: { initialNumItems: number },
        onData: (result: unknown) => void,
      ) => {
        onData({
          results: [],
          status: 'LoadingFirstPage',
          loadMore: loadMoreFn,
        });
        onData({
          results: [{ id: 'm1' }],
          status: 'CanLoadMore',
          loadMore: loadMoreFn,
        });
        return () => void 0;
      },
    );

    const fixture: ComponentFixture<PaginatedHostComponent> =
      TestBed.createComponent(PaginatedHostComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance.result.status()).toBe('success');
    expect(fixture.componentInstance.result.results()).toEqual([{ id: 'm1' }]);
    expect(fixture.componentInstance.result.canLoadMore()).toBe(true);

    const didLoadMore = fixture.componentInstance.result.loadMore(10);
    expect(didLoadMore).toBe(true);
    expect(loadMoreFn).toHaveBeenCalledWith(10);
  });

  it('injectPaginatedQuery re-subscribes on reset and supports skip token', async () => {
    const unsubA = vi.fn();
    const unsubB = vi.fn();
    mockConvex.onPaginatedUpdate_experimental
      .mockImplementationOnce(
        (
          _query: typeof TEST_PAGINATED_QUERY,
          _args: { filter: string },
          _options: { initialNumItems: number },
          onData: (result: unknown) => void,
        ) => {
          onData({
            results: [{ id: 'first' }],
            status: 'canLoadMore',
            loadMore: (_numItems: number) => true,
          });
          return unsubA;
        },
      )
      .mockImplementationOnce(
        (
          _query: typeof TEST_PAGINATED_QUERY,
          _args: { filter: string },
          _options: { initialNumItems: number },
          onData: (result: unknown) => void,
        ) => {
          onData({
            results: [{ id: 'second' }],
            status: 'exhausted',
            loadMore: (_numItems: number) => false,
          });
          return unsubB;
        },
      );

    const fixture: ComponentFixture<PaginatedHostComponent> =
      TestBed.createComponent(PaginatedHostComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance.result.results()).toEqual([{ id: 'first' }]);

    fixture.componentInstance.result.reset();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(unsubA).toHaveBeenCalledTimes(1);
    expect(mockConvex.onPaginatedUpdate_experimental).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.result.results()).toEqual([{ id: 'second' }]);

    fixture.componentInstance.args.set(skipToken);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.result.status()).toBe('skipped');
    expect(fixture.componentInstance.result.results()).toEqual([]);
  });

  it('injectPaginatedQuery marks load-more as unavailable after subscription error', async () => {
    const loadMoreFn = vi.fn().mockReturnValue(true);

    mockConvex.onPaginatedUpdate_experimental.mockImplementation(
      (
        _query: typeof TEST_PAGINATED_QUERY,
        _args: { filter: string },
        _options: { initialNumItems: number },
        onData: (result: unknown) => void,
        onError: (error: Error) => void,
      ) => {
        onData({
          results: [{ id: 'first' }],
          status: 'canLoadMore',
          loadMore: loadMoreFn,
        });
        onError(new Error('network'));
        return () => void 0;
      },
    );

    const fixture: ComponentFixture<PaginatedHostComponent> =
      TestBed.createComponent(PaginatedHostComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance.result.status()).toBe('error');
    expect(fixture.componentInstance.result.canLoadMore()).toBe(true);
    expect(fixture.componentInstance.result.isExhausted()).toBe(false);
    expect(fixture.componentInstance.result.loadMore(10)).toBe(true);
    expect(loadMoreFn).toHaveBeenCalledWith(10);
  });

  it('injectMutation tracks pending and success state', async () => {
    mockConvex.mutation.mockResolvedValue({ ok: true });

    const fixture: ComponentFixture<MutationActionHostComponent> = TestBed.createComponent(
      MutationActionHostComponent,
    );
    await fixture.whenStable();

    const promise = fixture.componentInstance.mutationResult.mutate({ id: 'm1' });

    expect(fixture.componentInstance.mutationResult.isLoading()).toBe(true);
    expect(fixture.componentInstance.mutationResult.status()).toBe('pending');

    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(fixture.componentInstance.mutationResult.status()).toBe('success');
    expect(fixture.componentInstance.mutationResult.data()).toEqual({ ok: true });
  });

  it('injectAction tracks errors and rethrows', async () => {
    mockConvex.action.mockRejectedValue(new Error('boom'));

    const fixture: ComponentFixture<MutationActionHostComponent> = TestBed.createComponent(
      MutationActionHostComponent,
    );
    await fixture.whenStable();

    await expect(fixture.componentInstance.actionResult.run({ id: 'a1' })).rejects.toThrow('boom');
    expect(fixture.componentInstance.actionResult.status()).toBe('error');
    expect(fixture.componentInstance.actionResult.error()?.message).toBe('boom');
  });

  it('injectConvexConnectionState reflects websocket connection changes', async () => {
    let connectionStateCallback: ((nextState: ConnectionState) => void) | null = null;
    const unsubscribe = vi.fn();

    mockConvex.subscribeToConnectionState.mockImplementation((cb: unknown) => {
      connectionStateCallback = cb as (nextState: ConnectionState) => void;
      return unsubscribe;
    });

    const fixture: ComponentFixture<ConnectionHostComponent> =
      TestBed.createComponent(ConnectionHostComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance.connection().isWebSocketConnected).toBe(false);
    expect(fixture.componentInstance.connection().connectionRetries).toBe(0);

    connectionStateCallback!(CONNECTED_CONNECTION_STATE);

    expect(fixture.componentInstance.connection().isWebSocketConnected).toBe(true);
    expect(fixture.componentInstance.connection().connectionCount).toBe(2);
    expect(fixture.componentInstance.connection().connectionRetries).toBe(1);

    fixture.destroy();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('injectConvex exposes the raw client instance', async () => {
    const fixture: ComponentFixture<ClientHostComponent> =
      TestBed.createComponent(ClientHostComponent);
    await fixture.whenStable();
    expect(fixture.componentInstance.client).toBe(mockConvex);
  });
});
