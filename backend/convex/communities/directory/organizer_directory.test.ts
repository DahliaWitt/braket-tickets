import {convexTest} from '../../setup.testing';
import {describe, expect, it} from 'vitest';
import {api, internal} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';
import {addMember, addTrustLink} from '../../lib/authz';
import {
  enqueueOrganizerDirectoryRebuild,
  enqueueMembershipPropagation,
  refreshOrganizerDirectoryForMembershipChange,
  refreshOrganizerDirectoryForTrustedMembers,
  searchUserApplicationsInDirectory,
} from '../../lib/users/organizer_directory';
import {searchUsersForAdminScope} from '../../lib/users/directory';

async function seedRootAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
) {
  await t.mutation(api.testing.users.setRootAdminStatus, {
    userId,
    isRootAdmin: true,
  });
}

async function seedCommunityAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
) {
  await t.mutation(api.testing.communities.seedCommunityAdmin, {
    userId,
    organizerId,
    grantedBy: userId,
  });
}

async function addOrganizerMember(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
) {
  await t.run(async (ctx) => {
    await addMember(ctx, userId, organizerId);
    await refreshOrganizerDirectoryForMembershipChange(ctx, {
      organizerId,
      userId,
    });
  });
}

async function seedTrustLink(
  t: ReturnType<typeof convexTest>,
  trustingOrganizerId: Id<'organizers'>,
  trustedOrganizerId: Id<'organizers'>,
) {
  await t.run(async (ctx) => {
    await addTrustLink(ctx, trustingOrganizerId, trustedOrganizerId);
    await refreshOrganizerDirectoryForTrustedMembers(ctx, {
      organizerId: trustingOrganizerId,
      trustedOrganizerId,
    });
  });
}

describe('Users', () => {
  it('allows admin to list users', async () => {
    const t = convexTest();

    // Create an admin user
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin User',
      email: 'admin@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    // Authenticate as admin
    const admin = t.withIdentity({
      subject: adminId,
      name: 'Admin User',
      email: 'admin@example.com',
    });

    // Add another user
    await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'user@example.com',
    });

    const users = await admin.query(api.users.profile.list, {});
    expect(users.length).toBe(2);
  });

  it('denies non-admin to list users', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'User',
      email: 'u@e.com',
    })) as Id<'users'>;

    const asUser = t.withIdentity({subject: userId});
    const users = await asUser.query(api.users.profile.list, {});
    expect(users).toEqual([]); // Backend returns empty array instead of throwing for list
  });

  it('rejects unauthenticated user lookup', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Lookup User',
      email: 'lookup@example.com',
    })) as Id<'users'>;

    await expect(
      t.query(api.users.profile.get, {
        id: userId,
      }),
    ).rejects.toThrow('Unauthenticated');
  });

  it('searches users correctly', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-search@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    await t.mutation(api.testing.users.createUserDirectly, {
      name: 'John Doe',
      email: 'john@example.com',
    });
    await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Jane Smith',
      email: 'jane@example.com',
    });

    const admin = t.withIdentity({subject: adminId});
    const results = await admin.query(api.users.profile.search, {
      query: 'John',
    });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('John Doe');
  });

  it('scopes community admin search to approved members in the selected organizer', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: 'cadmin-search@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Search Community',
      },
    )) as Id<'organizers'>;
    const otherOrganizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Other Community',
      },
    )) as Id<'organizers'>;
    await seedCommunityAdmin(t, adminId, organizerId);

    const approvedUserId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Scoped SearchTarget Approved',
        email: 'scoped-search-approved@example.com',
      },
    )) as Id<'users'>;
    const rejectedUserId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Scoped SearchTarget Rejected',
        email: 'scoped-search-rejected@example.com',
      },
    )) as Id<'users'>;
    const otherCommunityUserId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Scoped SearchTarget Other',
        email: 'scoped-search-other@example.com',
      },
    )) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: approvedUserId,
      organizerId,
      status: 'approved',
      answers: {},
    });

    await t.mutation(api.testing.applications.seedApplication, {
      userId: rejectedUserId,
      organizerId,
      status: 'rejected',
      answers: {},
    });

    await t.mutation(api.testing.applications.seedApplication, {
      userId: otherCommunityUserId,
      organizerId: otherOrganizerId,
      status: 'approved',
      answers: {},
    });

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 120 organizers + applications for pagination testing; too many individual mutations
    await t.run(async (ctx) => {
      for (let index = 0; index < 120; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const historyOrganizerId = await ctx.db.insert('organizers', {
          name: `History Community ${index}`,
          isPublicDirectory: true,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk application insert for pagination test; seedApplication would be too many individual mutations
        await ctx.db.insert('applications', {
          userId: approvedUserId,
          organizerId: historyOrganizerId,
          status: 'approved',
          answers: {},
        });
      }
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(api.users.profile.search, {
      query: 'scoped-search-',
      organizerId,
    });

    expect(results.map((user) => user._id)).toEqual([approvedUserId]);
    expect(results[0]?.name).toBe('Scoped SearchTarget Approved');
    expect(results.map((user) => user._id)).not.toContain(rejectedUserId);
    expect(results.map((user) => user._id)).not.toContain(otherCommunityUserId);
  });

  it('findByExactEmailForAdmin resolves existing non-member users for community team management', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: 'team-admin@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Team Management Community',
      },
    )) as Id<'organizers'>;
    await seedCommunityAdmin(t, adminId, organizerId);

    const targetId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Existing Non Member',
      email: 'existing-non-member@example.com',
    })) as Id<'users'>;

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(
      api.users.profile.findByExactEmailForAdmin,
      {
        email: ' Existing-Non-Member@Example.com ',
        organizerId,
      },
    );

    expect(result?._id).toBe(targetId);
    expect(Object.keys(result ?? {}).sort()).toEqual(['_id', 'email']);
  });

  it('findByExactEmailForAdmin denies callers who cannot manage the organizer', async () => {
    const t = convexTest();

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Private Team Management Community',
      },
    )) as Id<'organizers'>;
    const outsiderId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Outsider',
      email: 'team-outsider@example.com',
    })) as Id<'users'>;
    await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Existing User',
      email: 'existing-user@example.com',
    });

    const asOutsider = t.withIdentity({subject: outsiderId});
    await expect(
      asOutsider.query(api.users.profile.findByExactEmailForAdmin, {
        email: 'existing-user@example.com',
        organizerId,
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('uses the latest organizer application status when scoping community admin search', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: 'cadmin-history-search@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'History Search Community',
      },
    )) as Id<'organizers'>;
    await seedCommunityAdmin(t, adminId, organizerId);

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'History Search Target',
      email: 'history-search-target@example.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      organizerId,
      status: 'approved',
      answers: {version: 1},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      organizerId,
      status: 'rejected',
      answers: {version: 2},
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(api.users.profile.search, {
      query: 'history-search-target',
      organizerId,
    });

    expect(results.map((user) => user._id)).not.toContain(userId);
  });

  it('continues community admin search past the first 50 global matches to find scoped members', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: 'cadmin-pagination@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Search Pagination Community',
      },
    )) as Id<'organizers'>;
    const otherOrganizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Other Pagination Community',
      },
    )) as Id<'organizers'>;
    await seedCommunityAdmin(t, adminId, organizerId);

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 60 users + applications for pagination stress test; too many individual mutations
    const approvedUserId = await t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        const outOfScopeUserId = await ctx.db.insert('users', {
          name: `Global Match ${index}`,
          email: `shared-cap-${String(index).padStart(3, '0')}@example.com`,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk application insert for pagination test; seedApplication would be too many individual mutations
        await ctx.db.insert('applications', {
          userId: outOfScopeUserId,
          organizerId: otherOrganizerId,
          status: 'approved',
          answers: {},
        });
      }

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      const approvedUserId = await ctx.db.insert('users', {
        name: 'Scoped Match Beyond First Page',
        email: 'shared-cap-999@example.com',
      });
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk application insert for pagination test; seedApplication would be too many individual mutations
      await ctx.db.insert('applications', {
        userId: approvedUserId,
        organizerId,
        status: 'approved',
        answers: {},
      });

      return approvedUserId;
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(api.users.profile.search, {
      query: 'shared-cap-',
      organizerId,
    });

    expect(results.map((user) => user._id)).toEqual([approvedUserId]);
  });

  it('bounds the community-admin email search scan instead of streaming the entire global users range', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Bounded Scan Admin',
      email: 'bounded-scan-admin@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Bounded Scan Community',
      },
    )) as Id<'organizers'>;
    const otherOrganizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Bounded Scan Other Community',
      },
    )) as Id<'organizers'>;
    await seedCommunityAdmin(t, adminId, organizerId);

    // Out-of-scope users whose emails share the search prefix and sort BEFORE
    // the scoped member, approved only in an unrelated community. The search
    // term appears only in emails (never names), so the name search index
    // cannot match — this exercises the email branch specifically.
    for (let index = 0; index < 5; index += 1) {
      const outOfScopeId = (await t.mutation(
        api.testing.users.createUserDirectly,
        {
          name: `Outside Member ${index}`,
          email: `bound-dir-${String(index).padStart(3, '0')}@example.com`,
        },
      )) as Id<'users'>;
      await t.mutation(api.testing.applications.seedApplication, {
        userId: outOfScopeId,
        organizerId: otherOrganizerId,
        status: 'approved',
        answers: {},
      });
    }

    // Scoped approved member whose email sorts AFTER the out-of-scope window.
    const scopedMemberId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Scoped Approved Trailing',
        email: 'bound-dir-999@example.com',
      },
    )) as Id<'users'>;
    await t.mutation(api.testing.applications.seedApplication, {
      userId: scopedMemberId,
      organizerId,
      status: 'approved',
      answers: {},
    });

    // With a scan cap smaller than the number of preceding out-of-scope
    // matches, the scoped member sits beyond the scan window and is never
    // reached — proving the email scan is bounded. Before the fix the unbounded
    // stream walked the whole global range and would have returned it.
    const boundedResults = await t.run((ctx) =>
      searchUsersForAdminScope(ctx.db, {
        query: 'bound-dir-',
        organizerId,
        emailScanLimit: 3,
      }),
    );
    expect(boundedResults.map((user) => user._id)).not.toContain(
      scopedMemberId,
    );

    // With a window large enough to include it, the same member is returned —
    // the cap is the only reason it was dropped, so in-window scoped matches
    // are still surfaced correctly.
    const withinWindowResults = await t.run((ctx) =>
      searchUsersForAdminScope(ctx.db, {
        query: 'bound-dir-',
        organizerId,
        emailScanLimit: 6,
      }),
    );
    expect(withinWindowResults.map((user) => user._id)).toEqual([
      scopedMemberId,
    ]);
  });

  it('bounds the organizer-directory email search scan instead of streaming the entire global users range', async () => {
    const t = convexTest();

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Bounded Directory Community',
      },
    )) as Id<'organizers'>;

    // Out-of-scope users that are never added to the organizer directory, with
    // emails that share the prefix and sort before the scoped member.
    for (let index = 0; index < 5; index += 1) {
      await t.mutation(api.testing.users.createUserDirectly, {
        name: `Outside Directory ${index}`,
        email: `bound-org-${String(index).padStart(3, '0')}@example.com`,
      });
    }

    // Scoped directory member whose email sorts after the out-of-scope window.
    const scopedMemberId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Scoped Directory Trailing',
        email: 'bound-org-999@example.com',
      },
    )) as Id<'users'>;
    await t.mutation(api.testing.applications.seedApplication, {
      userId: scopedMemberId,
      organizerId,
      status: 'approved',
      answers: {},
    });
    await addOrganizerMember(t, scopedMemberId, organizerId);

    // Cap below the out-of-scope prefix run: the scoped directory row is beyond
    // the scan window and excluded (unbounded before the fix would have found
    // it after draining the global email range).
    const boundedPage = await t.run((ctx) =>
      searchUserApplicationsInDirectory(ctx, organizerId, 'bound-org-', {
        emailScanLimit: 3,
      }),
    );
    expect(boundedPage.page.map((row) => row.user._id)).not.toContain(
      scopedMemberId,
    );

    // A window large enough to reach the scoped row surfaces it — confirming
    // the cap, not a scoping bug, was responsible for the exclusion above.
    const withinWindowPage = await t.run((ctx) =>
      searchUserApplicationsInDirectory(ctx, organizerId, 'bound-org-', {
        emailScanLimit: 6,
      }),
    );
    expect(withinWindowPage.page.map((row) => row.user._id)).toEqual([
      scopedMemberId,
    ]);
  });

  it('lists active members with their latest application snapshot', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-lwa@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Community',
      },
    )) as Id<'organizers'>;

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Applicant',
      email: 'applicant-lwa@example.com',
    })) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      organizerId,
      status: 'pending',
      answers: {whyJoin: 'Test'},
    });
    await addOrganizerMember(t, userId, organizerId);

    const admin = t.withIdentity({subject: adminId});
    const results = await admin.query(api.users.profile.listWithApplications, {
      paginationOpts: {numItems: 10, cursor: null},
      organizerId,
    });

    const applicantRow = results.page.find((r) => r.user._id === userId);
    expect(applicantRow).toBeDefined();
    expect(applicantRow?.application?.status).toBe('pending');
    expect(applicantRow?.communityAccessSource).toBe('direct_member');
  });

  it('excludes application-only pending, rejected, and revoked applicants from the member directory', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-member-directory@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Member Directory Community',
      },
    )) as Id<'organizers'>;

    const approvedMemberId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Approved Directory Member',
        email: 'approved-directory-member@example.com',
      },
    )) as Id<'users'>;
    const pendingApplicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Pending Directory Applicant',
        email: 'pending-directory-applicant@example.com',
      },
    )) as Id<'users'>;
    const rejectedApplicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Rejected Directory Applicant',
        email: 'rejected-directory-applicant@example.com',
      },
    )) as Id<'users'>;
    const revokedApplicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Revoked Directory Applicant',
        email: 'revoked-directory-applicant@example.com',
      },
    )) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: approvedMemberId,
      organizerId,
      status: 'approved',
      answers: {},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: pendingApplicantId,
      organizerId,
      status: 'pending',
      answers: {},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: rejectedApplicantId,
      organizerId,
      status: 'rejected',
      answers: {},
    });
    await t.mutation(api.testing.applications.seedApplication, {
      userId: revokedApplicantId,
      organizerId,
      status: 'revoked',
      answers: {},
    });

    const admin = t.withIdentity({subject: adminId});
    const results = await admin.query(api.users.profile.listWithApplications, {
      paginationOpts: {numItems: 10, cursor: null},
      organizerId,
    });

    const rowIds = results.page.map((row) => row.user._id);
    expect(rowIds).toEqual([approvedMemberId]);
    expect(rowIds).not.toContain(pendingApplicantId);
    expect(rowIds).not.toContain(rejectedApplicantId);
    expect(rowIds).not.toContain(revokedApplicantId);
  });

  it('revokes membership', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-revoke@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Community',
      },
    )) as Id<'organizers'>;
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Member',
      email: 'member-revoke@example.com',
    })) as Id<'users'>;
    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId,
        organizerId,
        status: 'approved',
        answers: {},
      },
    )) as Id<'applications'>;
    await seedRootAdmin(t, adminId);
    await addOrganizerMember(t, userId, organizerId);

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.users.profile.revokeMembership, {
      userId,
      organizerId,
    });

    const [application, organizerApplications] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(applicationId),
        ctx.db
          .query('applications')
          .withIndex('by_user_status', (q) =>
            q.eq('userId', userId).eq('status', 'revoked'),
          )
          .collect(),
      ]),
    );
    expect(application?.status).toBe('revoked');
    expect(
      organizerApplications.some((entry) => entry.organizerId === organizerId),
    ).toBe(true);

    const logs = await t.run(async (ctx) =>
      ctx.db.query('adminAuditLogs').collect(),
    );
    expect(logs.length).toBe(1);
    expect(logs[0].adminId).toBe(adminId);
    expect(logs[0].action).toBe('user.revoke');
    expect(logs[0].source).toBe('admin-ui');
    expect(logs[0].organizerId).toBe(organizerId);
  });

  it('inserts a revoked row when the latest organizer application is no longer approved', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-latest-status@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Latest Status Community',
      },
    )) as Id<'organizers'>;
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Member With History',
      email: 'member-with-history@example.com',
    })) as Id<'users'>;
    const approvedApplicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId,
        organizerId,
        status: 'approved',
        answers: {version: 1},
      },
    )) as Id<'applications'>;
    const rejectedApplicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId,
        organizerId,
        status: 'rejected',
        answers: {version: 2},
      },
    )) as Id<'applications'>;

    await seedRootAdmin(t, adminId);
    await addOrganizerMember(t, userId, organizerId);

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.users.profile.revokeMembership, {
      userId,
      organizerId,
    });

    const organizerApplications = await t.run(async (ctx) =>
      ctx.db
        .query('applications')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', userId).eq('organizerId', organizerId),
        )
        .collect(),
    );

    const approvedApplication = organizerApplications.find(
      (application) => application._id === approvedApplicationId,
    );
    const rejectedApplication = organizerApplications.find(
      (application) => application._id === rejectedApplicationId,
    );
    const revokedApplications = organizerApplications.filter(
      (application) => application.status === 'revoked',
    );

    expect(approvedApplication?.status).toBe('approved');
    expect(rejectedApplication?.status).toBe('rejected');
    expect(revokedApplications).toHaveLength(1);
    expect(revokedApplications[0]?.processedBy).toBe(adminId);
  });

  it('revokes the existing organizer application even when the user has more than 100 applications', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-deephistory@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Deep History Community',
      },
    )) as Id<'organizers'>;
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Deep History Member',
      email: 'deep-history-member@example.com',
    })) as Id<'users'>;
    const applicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId,
        organizerId,
        status: 'approved',
        answers: {},
      },
    )) as Id<'applications'>;

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 100 organizers + applications for deep-history pagination test; too many individual mutations
    await t.run(async (ctx) => {
      for (let index = 0; index < 100; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const otherOrganizerId = await ctx.db.insert('organizers', {
          name: `Other Community ${index}`,
          isPublicDirectory: true,
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk application insert for pagination test; seedApplication would be too many individual mutations
        await ctx.db.insert('applications', {
          userId,
          organizerId: otherOrganizerId,
          status: 'approved',
          answers: {},
        });
      }
    });

    await seedRootAdmin(t, adminId);
    await addOrganizerMember(t, userId, organizerId);

    const admin = t.withIdentity({subject: adminId});
    await admin.mutation(api.users.profile.revokeMembership, {
      userId,
      organizerId,
    });

    const organizerApplications = await t.run(async (ctx) =>
      ctx.db
        .query('applications')
        .withIndex('by_organizer_status', (q) =>
          q.eq('organizerId', organizerId),
        )
        .collect(),
    );

    expect(organizerApplications).toHaveLength(1);
    expect(organizerApplications[0]?._id).toBe(applicationId);
    expect(organizerApplications[0]?.status).toBe('revoked');
  });

  it('returns current community admin organizer ids in users.current', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Role User',
      email: 'roles@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Org',
      },
    )) as Id<'organizers'>;
    await seedCommunityAdmin(t, userId, organizerId);

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(api.users.profile.current, {});

    expect(result).not.toBeNull();
    expect(result?.communityAdminOrganizerIds).toEqual([organizerId]);
  });

  it('returns root admin status in users.get for self', async () => {
    const t = convexTest();

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Role User',
      email: 'roles-get@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, userId);

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(api.users.profile.get, {id: userId});

    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).roles).toBeUndefined();
  });

  it('lists users with applications (latest only)', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-latest@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Community',
      },
    )) as Id<'organizers'>;

    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Applicant',
      email: 'applicant-latest@example.com',
    })) as Id<'users'>;

    // Create OLD application
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      organizerId,
      status: 'pending',
      answers: {whyJoin: 'Old'},
    });

    // Create NEW application
    await t.mutation(api.testing.applications.seedApplication, {
      userId,
      organizerId,
      status: 'approved',
      answers: {whyJoin: 'New'},
    });
    await addOrganizerMember(t, userId, organizerId);

    const admin = t.withIdentity({subject: adminId});
    const results = await admin.query(api.users.profile.listWithApplications, {
      paginationOpts: {numItems: 10, cursor: null},
      organizerId,
    });

    const applicantRow = results.page.find((r) => r.user._id === userId);
    expect(applicantRow).toBeDefined();
    // Should be the NEW one
    expect(applicantRow?.application?.status).toBe('approved');
    expect(applicantRow?.application?.answers.whyJoin).toBe('New');
  });

  it('lists magic-link-only and shared-trust-only members with organizer access', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: 'cadmin-magic@example.com',
    })) as Id<'users'>;

    const targetOrgId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Target Community',
      },
    )) as Id<'organizers'>;

    await seedCommunityAdmin(t, adminId, targetOrgId);

    const trustedOrgId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Trusted Community',
      },
    )) as Id<'organizers'>;

    const approvedMemberId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Approved Member',
        email: 'approved-member-magic@example.com',
      },
    )) as Id<'users'>;
    const magicMemberId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Magic Member',
        email: 'magic-member@example.com',
      },
    )) as Id<'users'>;
    const sharedOnlyMemberId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Shared Only Member',
        email: 'shared-only-member@example.com',
      },
    )) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: approvedMemberId,
      organizerId: targetOrgId,
      status: 'approved',
      answers: {},
    });

    const {linkId: magicLinkId} = await t.mutation(
      api.testing.magic_links.seedMagicLink,
      {
        createdBy: adminId,
        organizerId: targetOrgId,
        status: 'active',
        label: 'Target invite',
        token: 'target-invite-token',
      },
    );
    await t.mutation(api.testing.magic_links.seedMagicLinkRedemption, {
      magicLinkId,
      userId: magicMemberId,
    });

    await t.mutation(api.testing.applications.seedApplication, {
      userId: sharedOnlyMemberId,
      organizerId: trustedOrgId,
      status: 'approved',
      answers: {},
    });

    await addOrganizerMember(t, approvedMemberId, targetOrgId);
    await addOrganizerMember(t, magicMemberId, targetOrgId);
    await addOrganizerMember(t, sharedOnlyMemberId, trustedOrgId);
    await seedTrustLink(t, targetOrgId, trustedOrgId);

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: 10, cursor: null},
        organizerId: targetOrgId,
      },
    );

    const approvedRow = results.page.find(
      (row) => row.user._id === approvedMemberId,
    );
    const magicRow = results.page.find((row) => row.user._id === magicMemberId);
    const sharedRow = results.page.find(
      (row) => row.user._id === sharedOnlyMemberId,
    );

    expect(approvedRow?.communityAccessSource).toBe('approved_application');
    expect(magicRow?.communityAccessSource).toBe('magic_link');
    expect(magicRow?.application).toBeNull();
    expect(sharedRow?.communityAccessSource).toBe('shared');
    expect(sharedRow?.trustedViaOrganizerName).toBe('Trusted Community');
    expect(sharedRow?.application).toBeNull();
  });

  it('fails when shared-trust expansion exceeds the active trust link cap', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin Large Trust',
      email: 'cadmin-largetrust@example.com',
    })) as Id<'users'>;

    const targetOrgId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Target Community Large Trust',
      },
    )) as Id<'organizers'>;

    await seedCommunityAdmin(t, adminId, targetOrgId);

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 26 organizers + users + applications for trust link cap stress test; too many individual mutations
    const {trustedOrganizerIds} = await t.run(async (ctx) => {
      const sharedMemberIds: Id<'users'>[] = [];
      const trustedOrganizerIds: Id<'organizers'>[] = [];
      for (let index = 0; index < 26; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal organizer for test setup; seedOrganizer enforces slug/vetting validation not needed here
        const trustedOrgId = await ctx.db.insert('organizers', {
          name: `Trusted Community ${index}`,
          isPublicDirectory: true,
        });
        trustedOrganizerIds.push(trustedOrgId);
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        const memberId = await ctx.db.insert('users', {
          name: `Shared Member ${index}`,
        });
        sharedMemberIds.push(memberId);
        await addMember(ctx, memberId, trustedOrgId);

        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk application insert for pagination test; seedApplication would be too many individual mutations
        await ctx.db.insert('applications', {
          userId: memberId,
          organizerId: trustedOrgId,
          status: 'approved',
          answers: {},
        });
      }
      return {sharedMemberIds, trustedOrganizerIds};
    });
    await Promise.all(
      trustedOrganizerIds.map((trustedOrganizerId) =>
        seedTrustLink(t, targetOrgId, trustedOrganizerId),
      ),
    );

    const asAdmin = t.withIdentity({subject: adminId});
    await expect(
      asAdmin.query(api.users.profile.listWithApplications, {
        paginationOpts: {numItems: 50, cursor: null},
        organizerId: targetOrgId,
      }),
    ).rejects.toThrow('Too many active trust links (26). Max supported: 20.');
  });

  it('paginates organizer members without dropping later rows', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin Pagination',
      email: 'cadmin-pagination-rows@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Paginated Community',
      },
    )) as Id<'organizers'>;

    await seedCommunityAdmin(t, adminId, organizerId);

    const memberIds: Id<'users'>[] = [];
    for (let index = 0; index < 3; index += 1) {
      const userId = (await t.mutation(api.testing.users.createUserDirectly, {
        name: `Paged Member ${index}`,
        email: `paged-member-${index}@example.com`,
      })) as Id<'users'>;
      memberIds.push(userId);
      await t.mutation(api.testing.applications.seedApplication, {
        userId,
        organizerId,
        status: 'approved',
        answers: {},
      });
      await addOrganizerMember(t, userId, organizerId);
    }

    const asAdmin = t.withIdentity({subject: adminId});
    const firstPage = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: 2, cursor: null},
        organizerId,
      },
    );
    const secondPage = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: 2, cursor: firstPage.continueCursor},
        organizerId,
      },
    );
    const thirdPage = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: 2, cursor: secondPage.continueCursor},
        organizerId,
      },
    );

    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);
    expect(firstPage.continueCursor).not.toBe('');
    expect(secondPage.page).toHaveLength(2);
    expect(secondPage.continueCursor).not.toBe('');
    expect(thirdPage.page).toHaveLength(0);
    expect(thirdPage.isDone).toBe(true);
    expect(
      new Set(
        [...firstPage.page, ...secondPage.page, ...thirdPage.page].map(
          (row) => row.user._id,
        ),
      ),
    ).toEqual(new Set([adminId, ...memberIds]));
  });

  it('paginates active members without letting stale applicant rows consume the page', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Root Admin Active Page',
      email: 'root-admin-active-page@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Active Page Community',
      },
    )) as Id<'organizers'>;

    const activeMemberId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Visible Active Member',
        email: 'visible-active-member@example.com',
      },
    )) as Id<'users'>;
    const staleApplicantId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Stale Rejected Applicant',
        email: 'stale-rejected-applicant@example.com',
      },
    )) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: activeMemberId,
      organizerId,
      status: 'approved',
      answers: {},
    });

    const rejectedApplicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: staleApplicantId,
        organizerId,
        status: 'rejected',
        answers: {},
      },
    )) as Id<'applications'>;

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally creates the stale projection shape that caused pagination to hide real members.
    await t.run(async (ctx) => {
      const staleSortTime = Date.now() + 10_000;
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- stale directory rows are not producible through production writes.
      await ctx.db.insert('organizer_user_directory', {
        organizerId,
        userId: staleApplicantId,
        sortTime: staleSortTime,
        applicationId: rejectedApplicationId,
        applicationCreationTime: staleSortTime,
        applicationStatus: 'rejected',
        applicationAnswers: {},
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const firstPage = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: 1, cursor: null},
        organizerId,
      },
    );

    expect(firstPage.page).toHaveLength(1);
    expect(firstPage.page[0]?.user._id).toBe(activeMemberId);
    expect(firstPage.page[0]?.communityAccessSource).toBe(
      'approved_application',
    );
    expect(firstPage.isDone).toBe(true);
  });

  it('keeps source-less legacy rows when authz still grants current access', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Root Admin Legacy Active',
      email: 'root-admin-legacy-active@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Legacy Active Community',
      },
    )) as Id<'organizers'>;

    const legacyMemberId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Legacy Active Member',
        email: 'legacy-active-member@example.com',
      },
    )) as Id<'users'>;

    const revokedApplicationId = (await t.mutation(
      api.testing.applications.seedApplication,
      {
        userId: legacyMemberId,
        organizerId,
        status: 'revoked',
        answers: {},
      },
    )) as Id<'applications'>;

    await t.run(async (ctx) => {
      await addMember(ctx, legacyMemberId, organizerId);
      const now = Date.now();
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally seeds the pre-source projection shape that must survive rollout.
      await ctx.db.insert('organizer_user_directory', {
        organizerId,
        userId: legacyMemberId,
        sortTime: now,
        applicationId: revokedApplicationId,
        applicationCreationTime: now,
        applicationStatus: 'revoked',
        applicationAnswers: {},
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: 10, cursor: null},
        organizerId,
      },
    );

    const legacyRow = results.page.find(
      (row) => row.user._id === legacyMemberId,
    );
    expect(legacyRow?.application?.status).toBe('revoked');
    expect(legacyRow?.communityAccessSource).toBe('direct_member');
  });

  it('paginates organizer users beyond 500 application rows without dropping later members', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin Large Organizer',
      email: 'cadmin-large-org@example.com',
    })) as Id<'users'>;
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Large Organizer',
      },
    )) as Id<'organizers'>;

    await seedRootAdmin(t, adminId);

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk insert of 505 users + applications + directory rows for pagination coverage; production writes are exercised elsewhere
    const memberIds = await t.run(async (ctx) => {
      const ids: Id<'users'>[] = [];
      for (let index = 0; index < 505; index += 1) {
        const createdAt = Date.now() + index;
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
        const userId = await ctx.db.insert('users', {
          name: `Large Organizer Member ${index}`,
          email: `large-organizer-${index}@example.com`,
        });
        ids.push(userId);
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- bulk application insert for pagination test; seedApplication would be too many individual mutations
        const applicationId = await ctx.db.insert('applications', {
          userId,
          organizerId,
          status: 'approved',
          answers: {},
        });
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- projection rows are seeded directly here to keep the >500 pagination test fast and focused on read-path behavior
        await ctx.db.insert('organizer_user_directory', {
          organizerId,
          userId,
          sortTime: createdAt,
          applicationId,
          applicationCreationTime: createdAt,
          applicationStatus: 'approved',
          applicationAnswers: {},
          communityAccessSource: 'approved_application',
        });
      }
      return ids;
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const pageSize = 250;
    const firstPage = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: pageSize, cursor: null},
        organizerId,
      },
    );
    const secondPage = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: pageSize, cursor: firstPage.continueCursor},
        organizerId,
      },
    );
    const thirdPage = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: pageSize, cursor: secondPage.continueCursor},
        organizerId,
      },
    );

    expect(firstPage.page).toHaveLength(pageSize);
    expect(secondPage.page).toHaveLength(pageSize);
    expect(thirdPage.page).toHaveLength(5);
    expect(thirdPage.isDone).toBe(true);
    expect(
      new Set(
        [...firstPage.page, ...secondPage.page, ...thirdPage.page].map(
          (row) => row.user._id,
        ),
      ),
    ).toEqual(new Set(memberIds));
  });

  it('lists a revoked-application user after they regain current access', async () => {
    const t = convexTest();
    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin 2',
      email: 'cadmin-revoked@example.com',
    })) as Id<'users'>;

    const targetOrgId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Target Community Revoked',
      },
    )) as Id<'organizers'>;

    await seedCommunityAdmin(t, adminId, targetOrgId);

    const trustedOrgId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Trusted Community Revoked',
      },
    )) as Id<'organizers'>;

    const revokedMemberId = (await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Revoked Member',
        email: 'revoked-member@example.com',
      },
    )) as Id<'users'>;

    await t.mutation(api.testing.applications.seedApplication, {
      userId: revokedMemberId,
      organizerId: targetOrgId,
      status: 'approved',
      answers: {},
    });

    const {linkId: magicLinkId} = await t.mutation(
      api.testing.magic_links.seedMagicLink,
      {
        createdBy: adminId,
        organizerId: targetOrgId,
        status: 'active',
        label: 'Revoked target invite',
        token: 'revoked-target-invite-token',
      },
    );
    await t.mutation(api.testing.applications.seedApplication, {
      userId: revokedMemberId,
      organizerId: targetOrgId,
      status: 'revoked',
      answers: {},
    });

    await t.mutation(api.testing.magic_links.seedMagicLinkRedemption, {
      magicLinkId,
      userId: revokedMemberId,
    });

    await t.mutation(api.testing.applications.seedApplication, {
      userId: revokedMemberId,
      organizerId: trustedOrgId,
      status: 'approved',
      answers: {},
    });

    await addOrganizerMember(t, revokedMemberId, trustedOrgId);
    await seedTrustLink(t, targetOrgId, trustedOrgId);

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: 10, cursor: null},
        organizerId: targetOrgId,
      },
    );

    const revokedRow = results.page.find(
      (row) => row.user._id === revokedMemberId,
    );
    expect(revokedRow?.application?.status).toBe('revoked');
    expect(revokedRow?.communityAccessSource).toBe('magic_link');
    expect(revokedRow?.trustedViaOrganizerName).toBeUndefined();
  });

  it('coalesces duplicate organizer rebuild requests', async () => {
    const t = convexTest();
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Coalesced Rebuild Community',
      },
    )) as Id<'organizers'>;

    await t.run(async (ctx) => {
      await enqueueOrganizerDirectoryRebuild(ctx, organizerId);
      await enqueueOrganizerDirectoryRebuild(ctx, organizerId);

      const rebuild = await ctx.db
        .query('organizer_user_directory_rebuilds')
        .withIndex('by_organizer', (q) => q.eq('organizerId', organizerId))
        .unique();

      expect(rebuild?._id).toBeTruthy();
      expect(rebuild?.status).toBe('queued');
      expect(rebuild?.restartRequested).toBeUndefined();
    });
  });

  it('marks a running organizer rebuild for restart instead of queueing a duplicate', async () => {
    const t = convexTest();
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Restarted Rebuild Community',
      },
    )) as Id<'organizers'>;

    await t.run(async (ctx) => {
      await enqueueOrganizerDirectoryRebuild(ctx, organizerId);
      const rebuild = await ctx.db
        .query('organizer_user_directory_rebuilds')
        .withIndex('by_organizer', (q) => q.eq('organizerId', organizerId))
        .unique();

      expect(rebuild?._id).toBeTruthy();
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test forces the queued rebuild into a running state to verify duplicate requests set restartRequested instead of creating a second row
      await ctx.db.patch('organizer_user_directory_rebuilds', rebuild!._id, {
        status: 'running',
      });

      await enqueueOrganizerDirectoryRebuild(ctx, organizerId);

      const updatedRebuild = await ctx.db
        .query('organizer_user_directory_rebuilds')
        .withIndex('by_organizer', (q) => q.eq('organizerId', organizerId))
        .unique();

      expect(updatedRebuild?._id).toBe(rebuild?._id);
      expect(updatedRebuild?.status).toBe('running');
      expect(updatedRebuild?.restartRequested).toBe(true);
    });
  });

  it('coalesces duplicate membership propagation requests', async () => {
    const t = convexTest();
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Propagation Source Community',
      },
    )) as Id<'organizers'>;
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Propagation User',
      email: 'propagation-user@example.com',
    })) as Id<'users'>;

    await t.run(async (ctx) => {
      await enqueueMembershipPropagation(ctx, {organizerId, userId});
      await enqueueMembershipPropagation(ctx, {organizerId, userId});

      const propagation = await ctx.db
        .query('organizer_user_directory_membership_propagations')
        .withIndex('by_organizer_and_user', (q) =>
          q.eq('organizerId', organizerId).eq('userId', userId),
        )
        .unique();

      expect(propagation?._id).toBeTruthy();
      expect(propagation?.status).toBe('queued');
      expect(propagation?.restartRequested).toBeUndefined();
    });
  });

  it('marks a running membership propagation for restart instead of queueing a duplicate', async () => {
    const t = convexTest();
    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Propagation Restart Community',
      },
    )) as Id<'organizers'>;
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Propagation Restart User',
      email: 'propagation-restart-user@example.com',
    })) as Id<'users'>;

    await t.run(async (ctx) => {
      await enqueueMembershipPropagation(ctx, {organizerId, userId});
      const propagation = await ctx.db
        .query('organizer_user_directory_membership_propagations')
        .withIndex('by_organizer_and_user', (q) =>
          q.eq('organizerId', organizerId).eq('userId', userId),
        )
        .unique();

      expect(propagation?._id).toBeTruthy();
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- test forces the queued propagation into a running state to verify duplicate requests set restartRequested instead of creating a second row
      await ctx.db.patch(
        'organizer_user_directory_membership_propagations',
        propagation!._id,
        {status: 'running'},
      );

      await enqueueMembershipPropagation(ctx, {organizerId, userId});

      const updatedPropagation = await ctx.db
        .query('organizer_user_directory_membership_propagations')
        .withIndex('by_organizer_and_user', (q) =>
          q.eq('organizerId', organizerId).eq('userId', userId),
        )
        .unique();

      expect(updatedPropagation?._id).toBe(propagation?._id);
      expect(updatedPropagation?.status).toBe('running');
      expect(updatedPropagation?.restartRequested).toBe(true);
    });
  });

  it('propagates shared membership changes through the background worker', async () => {
    const t = convexTest();
    const trustingOrganizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Trusting Shared Worker Org',
      },
    )) as Id<'organizers'>;
    const trustedOrganizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Trusted Shared Worker Org',
      },
    )) as Id<'organizers'>;
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Shared Worker Member',
      email: 'shared-worker-member@example.com',
    })) as Id<'users'>;

    await t.run(async (ctx) => {
      await addTrustLink(ctx, trustingOrganizerId, trustedOrganizerId);
      await addMember(ctx, userId, trustedOrganizerId);
      await refreshOrganizerDirectoryForMembershipChange(ctx, {
        organizerId: trustedOrganizerId,
        userId,
      });
      await ctx.runMutation(
        internal.communities.directory.users
          .propagateMembershipChangeToTrustingOrganizersInternal,
        {
          organizerId: trustedOrganizerId,
          userId,
        },
      );

      const sharedEntry = await ctx.db
        .query('organizer_user_directory')
        .withIndex('by_organizer_and_user', (q) =>
          q.eq('organizerId', trustingOrganizerId).eq('userId', userId),
        )
        .unique();

      expect(sharedEntry?.communityAccessSource).toBe('shared');
      expect(sharedEntry?.trustedViaOrganizerName).toBe(
        'Trusted Shared Worker Org',
      );
    });
  });

  it('batches shared membership propagation across many trusting organizers', async () => {
    const t = convexTest();
    const trustedOrganizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Trusted Batch Worker Org',
      },
    )) as Id<'organizers'>;
    const userId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Batched Shared Worker Member',
      email: 'batched-shared-worker-member@example.com',
    })) as Id<'users'>;
    const trustingOrganizerIds = await Promise.all(
      Array.from(
        {length: 21},
        (_, index) =>
          t.mutation(api.testing.communities.seedOrganizer, {
            name: `Trusting Batch Worker Org ${index}`,
          }) as Promise<Id<'organizers'>>,
      ),
    );

    await t.run(async (ctx) => {
      for (const trustingOrganizerId of trustingOrganizerIds) {
        await addTrustLink(ctx, trustingOrganizerId, trustedOrganizerId);
      }
      await addMember(ctx, userId, trustedOrganizerId);

      const firstPage = await ctx.runMutation(
        internal.communities.directory.users
          .propagateMembershipChangeToTrustingOrganizersInternal,
        {
          organizerId: trustedOrganizerId,
          userId,
          paginationOpts: {cursor: null, numItems: 10},
        },
      );
      const secondPage = await ctx.runMutation(
        internal.communities.directory.users
          .propagateMembershipChangeToTrustingOrganizersInternal,
        {
          organizerId: trustedOrganizerId,
          userId,
          paginationOpts: {cursor: firstPage.continueCursor, numItems: 10},
        },
      );
      const thirdPage = await ctx.runMutation(
        internal.communities.directory.users
          .propagateMembershipChangeToTrustingOrganizersInternal,
        {
          organizerId: trustedOrganizerId,
          userId,
          paginationOpts: {cursor: secondPage.continueCursor, numItems: 10},
        },
      );

      expect(firstPage.processedOrganizers).toBe(10);
      expect(firstPage.isDone).toBe(false);
      expect(firstPage.continueCursor).not.toBe('');
      expect(secondPage.processedOrganizers).toBe(10);
      expect(secondPage.isDone).toBe(false);
      expect(secondPage.continueCursor).not.toBe('');
      expect(thirdPage.processedOrganizers).toBe(1);
      expect(thirdPage.isDone).toBe(true);

      for (const trustingOrganizerId of trustingOrganizerIds) {
        const sharedEntry = await ctx.db
          .query('organizer_user_directory')
          .withIndex('by_organizer_and_user', (q) =>
            q.eq('organizerId', trustingOrganizerId).eq('userId', userId),
          )
          .unique();

        expect(sharedEntry?.communityAccessSource).toBe('shared');
        expect(sharedEntry?.trustedViaOrganizerName).toBe(
          'Trusted Batch Worker Org',
        );
      }
    });
  });

  it('current does not expose emailChangeToken', async () => {
    const t = convexTest();

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailChangeToken/emailChangeTokenExpiry not settable via createUserDirectly; needed to test field stripping
    const userId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {
        name: 'Token User',
        email: 'token@example.com',
        emailChangeToken: 'secret-token-abc',
        emailChangeTokenExpiry: Date.now() + 3600000,
      });
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(api.users.profile.current, {});

    expect(result).not.toBeNull();
    expect(
      (result as Record<string, unknown>).emailChangeToken,
    ).toBeUndefined();
    expect(
      (result as Record<string, unknown>).emailChangeTokenExpiry,
    ).toBeUndefined();
  });

  it('get does not expose emailChangeToken (self)', async () => {
    const t = convexTest();

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailChangeToken/emailChangeTokenExpiry not settable via createUserDirectly; needed to test field stripping
    const userId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {
        name: 'Token User Self',
        email: 'token-self@example.com',
        emailChangeToken: 'secret-self-token',
        emailChangeTokenExpiry: Date.now() + 3600000,
      });
    });

    const asUser = t.withIdentity({subject: userId});
    const result = await asUser.query(api.users.profile.get, {id: userId});

    expect(result).not.toBeNull();
    expect(
      (result as Record<string, unknown>).emailChangeToken,
    ).toBeUndefined();
    expect(
      (result as Record<string, unknown>).emailChangeTokenExpiry,
    ).toBeUndefined();
  });

  it('get does not expose emailChangeToken (admin viewing other user)', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin2@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailChangeToken/emailChangeTokenExpiry not settable via createUserDirectly; needed to test field stripping
    const targetUserId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {
        name: 'Target User',
        email: 'target@example.com',
        emailChangeToken: 'secret-admin-view-token',
        emailChangeTokenExpiry: Date.now() + 3600000,
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(api.users.profile.get, {
      id: targetUserId,
    });

    expect(result).not.toBeNull();
    expect(
      (result as Record<string, unknown>).emailChangeToken,
    ).toBeUndefined();
    expect(
      (result as Record<string, unknown>).emailChangeTokenExpiry,
    ).toBeUndefined();
  });

  it('list does not expose emailChangeToken', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin3@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailChangeToken/emailChangeTokenExpiry not settable via createUserDirectly; needed to test field stripping
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      await ctx.db.insert('users', {
        name: 'Listed User',
        email: 'listed@example.com',
        emailChangeToken: 'secret-list-token',
        emailChangeTokenExpiry: Date.now() + 3600000,
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const users = await asAdmin.query(api.users.profile.list, {});

    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(
        (user as Record<string, unknown>).emailChangeToken,
      ).toBeUndefined();
      expect(
        (user as Record<string, unknown>).emailChangeTokenExpiry,
      ).toBeUndefined();
    }
  });

  it('search does not expose emailChangeToken', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-search@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailChangeToken/emailChangeTokenExpiry not settable via createUserDirectly; needed to test field stripping
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      await ctx.db.insert('users', {
        name: 'SearchTarget User',
        email: 'searchtarget@example.com',
        emailChangeToken: 'secret-search-token',
        emailChangeTokenExpiry: Date.now() + 3600000,
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(api.users.profile.search, {
      query: 'SearchTarget',
    });

    expect(results.length).toBeGreaterThan(0);
    for (const user of results) {
      expect(
        (user as Record<string, unknown>).emailChangeToken,
      ).toBeUndefined();
      expect(
        (user as Record<string, unknown>).emailChangeTokenExpiry,
      ).toBeUndefined();
    }
  });

  it('listWithApplications (root admin) does not expose emailChangeToken', async () => {
    const t = convexTest();

    const adminId = (await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-lwa@example.com',
    })) as Id<'users'>;
    await seedRootAdmin(t, adminId);

    const organizerId = (await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Community',
      },
    )) as Id<'organizers'>;

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- emailChangeToken/emailChangeTokenExpiry not settable via createUserDirectly; needed to test field stripping
    const targetUserId = await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- intentionally minimal user without email for authz/query testing; createUserDirectly requires email
      return await ctx.db.insert('users', {
        name: 'LWA Target User',
        email: 'lwa-target@example.com',
        emailChangeToken: 'secret-lwa-token',
        emailChangeTokenExpiry: Date.now() + 3600000,
      });
    });

    await t.mutation(api.testing.applications.seedApplication, {
      userId: targetUserId as Id<'users'>,
      organizerId,
      status: 'pending',
      answers: {whyJoin: 'Test LWA'},
    });
    await addOrganizerMember(t, targetUserId as Id<'users'>, organizerId);

    const asAdmin = t.withIdentity({subject: adminId});
    const results = await asAdmin.query(
      api.users.profile.listWithApplications,
      {
        paginationOpts: {numItems: 10, cursor: null},
        organizerId,
      },
    );

    expect(results.page.length).toBeGreaterThan(0);
    for (const row of results.page) {
      expect(
        (row.user as Record<string, unknown>).emailChangeToken,
      ).toBeUndefined();
      expect(
        (row.user as Record<string, unknown>).emailChangeTokenExpiry,
      ).toBeUndefined();
    }
  });
});
