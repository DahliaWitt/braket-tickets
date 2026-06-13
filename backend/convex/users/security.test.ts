import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {api} from '../_generated/api';
import type {Id} from '../_generated/dataModel';

async function createUser(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<'users'>> {
  return (await t.mutation(api.testing.users.createUserDirectly, {
    name: email.split('@')[0] ?? 'User',
    email,
  })) as Id<'users'>;
}

async function seedOrganizer(
  t: ReturnType<typeof convexTest>,
  name: string,
): Promise<Id<'organizers'>> {
  return await t.mutation(api.testing.communities.seedOrganizer, {
    name,
    status: 'published',
  });
}

async function seedCommunityAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.mutation(api.testing.communities.seedCommunityAdmin, {
    userId,
    organizerId,
    grantedBy: userId,
  });
}

describe('Users Security', () => {
  it('prevents updating user with excessively long name', async () => {
    const t = convexTest();

    // Create a user
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'security-long-name@example.com',
    })) as Id<'users'>;

    const user = t.withIdentity({subject: userId});

    // Create a 5000 char string — sanitizeName truncates to MAX_NAME_LENGTH (100)
    const longName = 'a'.repeat(5000);

    await user.mutation(api.users.profile.update, {name: longName});

    const profile = await user.query(api.users.profile.current, {});
    expect(profile?.name).toBe('a'.repeat(100));
  });

  it('allows updating user with valid length name', async () => {
    const t = convexTest();
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'security-valid-name@example.com',
    })) as Id<'users'>;
    const user = t.withIdentity({subject: userId});

    const validName = 'Valid Name';
    await user.mutation(api.users.profile.update, {name: validName});

    const updatedUser = await t.run(async (ctx) => await ctx.db.get(userId));
    expect(updatedUser?.name).toBe(validName);
  });

  it('allows a community admin to save a managed default community', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'managed-default@example.com');
    const organizerId = await seedOrganizer(t, 'Managed Default');
    await seedCommunityAdmin(t, userId, organizerId);

    const user = t.withIdentity({subject: userId});
    await user.mutation(api.users.profile.setDefaultCommunityAdminOrganizer, {
      organizerId,
    });

    const profile = await user.query(api.users.profile.current, {});
    expect(profile?.defaultCommunityAdminOrganizerId).toBe(organizerId);
  });

  it('hides default community preference from shared user directory rows', async () => {
    const t = convexTest();
    const adminId = await createUser(t, 'directory-admin-default@example.com');
    const targetId = await createUser(
      t,
      'directory-target-default@example.com',
    );
    const visibleOrganizerId = await seedOrganizer(t, 'Visible Directory');
    const defaultOrganizerId = await seedOrganizer(t, 'Private Default');
    await seedCommunityAdmin(t, adminId, visibleOrganizerId);
    await seedCommunityAdmin(t, targetId, visibleOrganizerId);
    await seedCommunityAdmin(t, targetId, defaultOrganizerId);
    await t.mutation(api.testing.applications.seedApplication, {
      userId: targetId,
      organizerId: visibleOrganizerId,
      status: 'approved',
      answers: {whyJoin: 'Directory visibility'},
    });

    const target = t.withIdentity({subject: targetId});
    await target.mutation(api.users.profile.setDefaultCommunityAdminOrganizer, {
      organizerId: defaultOrganizerId,
    });

    const admin = t.withIdentity({subject: adminId});
    const listedUsers = await admin.query(api.users.profile.list, {
      organizerId: visibleOrganizerId,
    });
    const listedTarget = listedUsers.find((user) => user._id === targetId);
    expect(listedTarget).toBeDefined();
    expect(listedTarget).not.toHaveProperty('defaultCommunityAdminOrganizerId');

    const searchResults = await admin.query(api.users.profile.search, {
      organizerId: visibleOrganizerId,
      query: 'directory-target-default',
    });
    const searchedTarget = searchResults.find((user) => user._id === targetId);
    expect(searchedTarget).toBeDefined();
    expect(searchedTarget).not.toHaveProperty(
      'defaultCommunityAdminOrganizerId',
    );

    const applicationRows = await admin.query(
      api.users.profile.listWithApplications,
      {
        organizerId: visibleOrganizerId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );
    const targetRow = applicationRows.page.find(
      (row) => row.user._id === targetId,
    );
    expect(targetRow).toBeDefined();
    expect(targetRow?.user).not.toHaveProperty(
      'defaultCommunityAdminOrganizerId',
    );
  });

  it('omits a saved default after community admin access is revoked', async () => {
    const t = convexTest();
    const targetId = await createUser(t, 'revoked-default@example.com');
    const backupAdminId = await createUser(t, 'revoker-default@example.com');
    const organizerId = await seedOrganizer(t, 'Revoked Default');
    const remainingOrganizerId = await seedOrganizer(t, 'Remaining Default');
    await seedCommunityAdmin(t, targetId, organizerId);
    await seedCommunityAdmin(t, targetId, remainingOrganizerId);
    await seedCommunityAdmin(t, backupAdminId, organizerId);

    const target = t.withIdentity({subject: targetId});
    await target.mutation(api.users.profile.setDefaultCommunityAdminOrganizer, {
      organizerId,
    });

    const backupAdmin = t.withIdentity({subject: backupAdminId});
    await backupAdmin.mutation(api.communities.admins.revoke, {
      userId: targetId,
      organizerId,
    });

    const profile = await target.query(api.users.profile.current, {});
    expect(profile?.communityAdminOrganizerIds).not.toContain(organizerId);
    expect(profile?.communityAdminOrganizerIds).toContain(remainingOrganizerId);
    expect(profile?.defaultCommunityAdminOrganizerId).toBeUndefined();
  });

  it('rejects unauthenticated default community updates', async () => {
    const t = convexTest();
    const organizerId = await seedOrganizer(t, 'Unauthenticated Default');

    await expect(
      t.mutation(api.users.profile.setDefaultCommunityAdminOrganizer, {
        organizerId,
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('rejects default community updates from non-admin users', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'non-admin-default@example.com');
    const organizerId = await seedOrganizer(t, 'Non Admin Default');

    const user = t.withIdentity({subject: userId});
    await expect(
      user.mutation(api.users.profile.setDefaultCommunityAdminOrganizer, {
        organizerId,
      }),
    ).rejects.toThrow('Unauthorized');

    const profile = await user.query(api.users.profile.current, {});
    expect(profile?.defaultCommunityAdminOrganizerId).toBeUndefined();
  });

  it('rejects a community admin default for an unmanaged community', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'unmanaged-default@example.com');
    const managedOrganizerId = await seedOrganizer(t, 'Managed Community');
    const unmanagedOrganizerId = await seedOrganizer(t, 'Unmanaged Community');
    await seedCommunityAdmin(t, userId, managedOrganizerId);

    const user = t.withIdentity({subject: userId});
    await expect(
      user.mutation(api.users.profile.setDefaultCommunityAdminOrganizer, {
        organizerId: unmanagedOrganizerId,
      }),
    ).rejects.toThrow('Unauthorized');

    const profile = await user.query(api.users.profile.current, {});
    expect(profile?.defaultCommunityAdminOrganizerId).toBeUndefined();
  });

  it('allows a root admin to save any existing community as default', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'root-default@example.com');
    const organizerId = await seedOrganizer(t, 'Root Default');
    await t.mutation(api.testing.users.setRootAdminStatus, {
      userId,
      isRootAdmin: true,
    });

    const rootAdmin = t.withIdentity({subject: userId});
    await rootAdmin.mutation(
      api.users.profile.setDefaultCommunityAdminOrganizer,
      {organizerId},
    );

    const profile = await rootAdmin.query(api.users.profile.current, {});
    expect(profile?.defaultCommunityAdminOrganizerId).toBe(organizerId);
  });

  it('omits a root admin saved default after the community is deleted', async () => {
    const t = convexTest();
    const userId = await createUser(t, 'deleted-root-default@example.com');
    const organizerId = await seedOrganizer(t, 'Deleted Root Default');
    await t.mutation(api.testing.users.setRootAdminStatus, {
      userId,
      isRootAdmin: true,
    });

    const rootAdmin = t.withIdentity({subject: userId});
    await rootAdmin.mutation(
      api.users.profile.setDefaultCommunityAdminOrganizer,
      {organizerId},
    );
    await rootAdmin.mutation(api.communities.profile.remove, {id: organizerId});

    const profile = await rootAdmin.query(api.users.profile.current, {});
    expect(profile?.defaultCommunityAdminOrganizerId).toBeUndefined();
  });
});
