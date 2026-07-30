import {makeFunctionReference} from 'convex/server';
import {describe, expect, it} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import {convexTest} from '../setup.testing';

const getSettings = makeFunctionReference<
  'query',
  {organizerId: Id<'organizers'>},
  {artistSlots: number; staffSlots: number}
>('communities/management/guest_list_settings:get');

const updateSettings = makeFunctionReference<
  'mutation',
  {
    organizerId: Id<'organizers'>;
    artistSlots: number;
    staffSlots: number;
  },
  {artistSlots: number; staffSlots: number}
>('communities/management/guest_list_settings:update');

async function setupManager() {
  const t = convexTest();
  const organizerId = await t.mutation(
    api.testing.communities.seedOrganizer,
    {name: 'Self-service guest list contracts'},
  );
  const userId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Guest list manager',
    email: 'guest-list-manager@example.com',
    isRootAdmin: true,
  });
  return {t, organizerId, manager: t.withIdentity({subject: userId})};
}

describe('self-service guest-list contracts', () => {
  it('returns effective 2/2 defaults before settings are saved', async () => {
    const {manager, organizerId} = await setupManager();

    await expect(manager.query(getSettings, {organizerId})).resolves.toEqual({
      artistSlots: 2,
      staffSlots: 2,
    });
  });

  it('persists explicit non-negative community defaults', async () => {
    const {manager, organizerId} = await setupManager();

    await expect(
      manager.mutation(updateSettings, {
        organizerId,
        artistSlots: 4,
        staffSlots: 1,
      }),
    ).resolves.toEqual({artistSlots: 4, staffSlots: 1});

    await expect(manager.query(getSettings, {organizerId})).resolves.toEqual({
      artistSlots: 4,
      staffSlots: 1,
    });
  });

});
