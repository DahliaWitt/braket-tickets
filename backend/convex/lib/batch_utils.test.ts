/**
 * @vitest-environment node
 */
import {describe, it, expect, vi} from 'vitest';
import type {Id, Doc, TableNames} from '../_generated/dataModel';
import {batchGetDocuments, batchGetUsers} from './batch_utils';

// Type helpers for testing
type UsersTable = 'users';
type EventsTable = 'events';

// Mock document factory
function createMockUserDoc(
  id: string,
  data: Record<string, unknown> = {},
): Doc<UsersTable> {
  return {
    _id: id as Id<UsersTable>,
    _creationTime: Date.now(),
    ...data,
  } as Doc<UsersTable>;
}

function createMockEventDoc(
  id: string,
  data: Record<string, unknown> = {},
): Doc<EventsTable> {
  return {
    _id: id as Id<EventsTable>,
    _creationTime: Date.now(),
    ...data,
  } as Doc<EventsTable>;
}

/**
 * Creates a mock context with db.get that returns documents from the provided map.
 * Uses type coercion for test mocks (full db interface not needed for these unit tests).
 */
function createMockCtx(docsByTable: Record<string, Map<string, unknown>>) {
  return {
    db: {
      get: vi.fn(async (tableOrId: string, maybeId?: string) => {
        const id = maybeId ?? tableOrId;
        for (const [, docs] of Object.entries(docsByTable)) {
          if (docs.has(id)) {
            return docs.get(id);
          }
        }
        return null;
      }),
      // Add stubs for unused db methods to satisfy type checker
      system: null,
      query: vi.fn(),
      normalizeId: vi.fn(),
    },
  };
}

// Type-safe mock context getter (casts to expected interface)
function getMockCtx(docsByTable: Record<string, Map<string, unknown>>) {
  return createMockCtx(docsByTable) as unknown as Parameters<
    typeof batchGetDocuments
  >[0];
}

// Helper to create typed ID array
function userIds(...ids: string[]): Id<UsersTable>[] {
  return ids as Id<UsersTable>[];
}

function eventIds(...ids: string[]): Id<EventsTable>[] {
  return ids as Id<EventsTable>[];
}

// Table name constant
const USERS_TABLE = 'users' as const satisfies TableNames;
const EVENTS_TABLE = 'events' as const satisfies TableNames;

describe('batchGetDocuments', () => {
  it('should fetch documents by their IDs', async () => {
    const user1 = createMockUserDoc('user1', {name: 'Alice'});
    const user2 = createMockUserDoc('user2', {name: 'Bob'});

    const mockCtx = getMockCtx({
      users: new Map([
        ['user1', user1],
        ['user2', user2],
      ]),
    });

    const result = await batchGetDocuments(
      mockCtx,
      USERS_TABLE,
      userIds('user1', 'user2'),
    );

    expect(result.size).toBe(2);
    expect(result.get('user1' as Id<UsersTable>)).toEqual(user1);
    expect(result.get('user2' as Id<UsersTable>)).toEqual(user2);
  });

  it('should deduplicate IDs', async () => {
    const user1 = createMockUserDoc('user1', {name: 'Alice'});

    const rawCtx = createMockCtx({
      users: new Map([['user1', user1]]),
    });

    await batchGetDocuments(
      rawCtx as unknown as Parameters<typeof batchGetDocuments>[0],
      USERS_TABLE,
      userIds('user1', 'user1', 'user1'),
    );

    // Should only call db.get once for the deduplicated ID
    expect(rawCtx.db.get).toHaveBeenCalledTimes(1);
  });

  it('should exclude null results from the map', async () => {
    const user1 = createMockUserDoc('user1', {name: 'Alice'});

    const mockCtx = getMockCtx({
      users: new Map([['user1', user1]]),
    });

    const result = await batchGetDocuments(
      mockCtx,
      USERS_TABLE,
      userIds('user1', 'nonexistent'),
    );

    expect(result.size).toBe(1);
    expect(result.has('user1' as Id<UsersTable>)).toBe(true);
    expect(result.has('nonexistent' as Id<UsersTable>)).toBe(false);
  });

  it('should work with different table types', async () => {
    const event1 = createMockEventDoc('event1', {title: 'Party'});

    const mockCtx = getMockCtx({
      events: new Map([['event1', event1]]),
    });

    const result = await batchGetDocuments(
      mockCtx,
      EVENTS_TABLE,
      eventIds('event1'),
    );

    expect(result.size).toBe(1);
    expect(result.get('event1' as Id<EventsTable>)).toEqual(event1);
  });
});

describe('batchGetUsers', () => {
  it('should fetch users by their IDs', async () => {
    const user1 = createMockUserDoc('user1', {
      name: 'Alice',
      email: 'alice@test.com',
    });
    const user2 = createMockUserDoc('user2', {
      name: 'Bob',
      email: 'bob@test.com',
    });

    const mockCtx = getMockCtx({
      users: new Map([
        ['user1', user1],
        ['user2', user2],
      ]),
    });

    const result = await batchGetUsers(mockCtx, userIds('user1', 'user2'));

    expect(result.size).toBe(2);
    expect(result.get('user1' as Id<UsersTable>)).toEqual(user1);
    expect(result.get('user2' as Id<UsersTable>)).toEqual(user2);
  });
});
