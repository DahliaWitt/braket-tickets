import {beforeEach, describe, expect, it, vi} from 'vitest';
import {internal} from '../_generated/api';
import {requireGuestTicketSendAccess} from './_impl/guest_ticket_access';

describe('guest ticket access helpers', () => {
  const runQuery = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('authorizes guest ticket sends with event admin access for the guest event', async () => {
    const guest = {
      _id: 'guest_123',
      _creationTime: 0,
      eventId: 'event_456',
      name: 'Pat Guest',
      email: 'pat@example.com',
      type: 'guest',
    };
    runQuery
      .mockResolvedValueOnce('user_789')
      .mockResolvedValueOnce(guest)
      .mockResolvedValueOnce(true);

    const result = await requireGuestTicketSendAccess(
      {runQuery} as never,
      'guest_123' as never,
    );

    expect(result).toStrictEqual(guest);
    expect(runQuery).toHaveBeenNthCalledWith(
      1,
      internal.lib.auth_helpers.getAuthUserIdInternal,
      {},
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      2,
      internal.events.guests.getInternal,
      {id: 'guest_123'},
    );
    expect(runQuery).toHaveBeenNthCalledWith(
      3,
      internal.lib.access._isEventAdmin,
      {userId: 'user_789', eventId: 'event_456'},
    );
    expect(runQuery.mock.calls.map(([ref]) => ref)).not.toContain(
      internal.lib.access._isRootAdmin,
    );
  });

  it('rejects callers without event admin access', async () => {
    runQuery
      .mockResolvedValueOnce('user_789')
      .mockResolvedValueOnce({
        _id: 'guest_123',
        _creationTime: 0,
        eventId: 'event_456',
        name: 'Pat Guest',
        email: 'pat@example.com',
        type: 'guest',
      })
      .mockResolvedValueOnce(false);

    await expect(
      requireGuestTicketSendAccess({runQuery} as never, 'guest_123' as never),
    ).rejects.toThrow();

    expect(runQuery).toHaveBeenLastCalledWith(
      internal.lib.access._isEventAdmin,
      {userId: 'user_789', eventId: 'event_456'},
    );
  });

  it('rejects unauthenticated callers before loading the guest', async () => {
    runQuery.mockResolvedValueOnce(null);

    await expect(
      requireGuestTicketSendAccess({runQuery} as never, 'guest_123' as never),
    ).rejects.toThrow();

    expect(runQuery).toHaveBeenCalledOnce();
    expect(runQuery).toHaveBeenCalledWith(
      internal.lib.auth_helpers.getAuthUserIdInternal,
      {},
    );
  });

  it('rejects missing guests before checking event admin access', async () => {
    runQuery.mockResolvedValueOnce('user_789').mockResolvedValueOnce(null);

    await expect(
      requireGuestTicketSendAccess({runQuery} as never, 'guest_123' as never),
    ).rejects.toThrow();

    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery.mock.calls.map(([ref]) => ref)).not.toContain(
      internal.lib.access._isEventAdmin,
    );
  });

  it('rejects guests without email before checking event admin access', async () => {
    runQuery.mockResolvedValueOnce('user_789').mockResolvedValueOnce({
      _id: 'guest_123',
      _creationTime: 0,
      eventId: 'event_456',
      name: 'Pat Guest',
      type: 'guest',
    });

    await expect(
      requireGuestTicketSendAccess({runQuery} as never, 'guest_123' as never),
    ).rejects.toThrow();

    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(runQuery.mock.calls.map(([ref]) => ref)).not.toContain(
      internal.lib.access._isEventAdmin,
    );
  });
});
