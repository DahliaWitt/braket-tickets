import {describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import {convexTest} from '../setup.testing';

describe('guest seed helpers', () => {
  it('keeps guest-list event stats aligned for organizer overview queries', async () => {
    const t = convexTest();
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Guest seed stats',
        status: 'published',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Guest seed stats event',
      date: '2035-07-10T20:00:00.000Z',
      endDate: '2035-07-11T06:00:00.000Z',
      price: 2000,
      organizerId,
      visibility: 'public',
      ticketSalesStatus: 'active',
    });
    const managerId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Guest seed stats manager',
      email: 'guest-seed-stats@example.com',
      isRootAdmin: true,
    });
    const manager = t.withIdentity({subject: managerId});

    await t.mutation(api.testing.guests.seedGuest, {
      eventId,
      name: 'Seeded Guest One',
      email: 'seeded-one@example.com',
      type: 'guest',
    });
    await t.mutation(api.testing.guests.seedGuest, {
      eventId,
      name: 'Seeded Guest Two',
      type: 'staff',
    });

    await expect(
      manager.query(api.guest_list.assignments.getEventOverview, {eventId}),
    ).resolves.toMatchObject({
      selfServiceGuestCount: 0,
      totalGuestAdmissionCount: 2,
    });
  });
});
