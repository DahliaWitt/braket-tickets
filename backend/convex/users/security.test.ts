import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

describe('Users Security', () => {
  it('prevents updating user with excessively long name', async () => {
    const t = convexTest();

    // Create a user
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'security-long-name@example.com',
    }) as Id<'users'>;

    const user = t.withIdentity({subject: userId});

    // Create a 5000 char string — sanitizeName truncates to MAX_NAME_LENGTH (100)
    const longName = 'a'.repeat(5000);

    await user.mutation(api.users.profile.update, {name: longName});

    const profile = await user.query(api.users.profile.current, {});
    expect(profile?.name).toBe('a'.repeat(100));
  });

  it('allows updating user with valid length name', async () => {
    const t = convexTest();
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'security-valid-name@example.com',
    }) as Id<'users'>;
    const user = t.withIdentity({subject: userId});

    const validName = 'Valid Name';
    await user.mutation(api.users.profile.update, {name: validName});

    const updatedUser = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(updatedUser?.name).toBe(validName);
  });

});
