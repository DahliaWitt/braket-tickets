import {convexTest} from '../../setup.testing';
import {describe, it, expect} from 'vitest';
import {api, internal} from '../../_generated/api';
import type {Id} from '../../_generated/dataModel';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {addMember, authz, authzUserId} from '../../lib/authz';

async function createRootAdmin(
  t: ReturnType<typeof convexTest>,
  {
    name = 'Admin User',
    email = 'admin@example.com',
  }: {name?: string; email?: string} = {},
): Promise<Id<'users'>> {
  return t.mutation(api.testing.users.createUserDirectly, {
    name,
    email,
    isRootAdmin: true,
  });
}

async function grantCommunityAdmin(
  t: ReturnType<typeof convexTest>,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  await t.run(async (ctx) => {
    await authz.assignRole(ctx, authzUserId(userId), 'community_admin', {
      type: 'organizer',
      id: organizerId as string,
    });
    await addMember(ctx, userId, organizerId);
  });
}

async function insertAuditLog(
  t: ReturnType<typeof convexTest>,
  args: {
    adminId: Id<'users'>;
    action: (typeof ADMIN_AUDIT_ACTIONS)[keyof typeof ADMIN_AUDIT_ACTIONS];
    organizerId?: Id<'organizers'>;
    eventId?: Id<'events'>;
    applicationId?: Id<'applications'>;
    magicLinkId?: Id<'magic_links'>;
    trustingOrganizerId?: Id<'organizers'>;
    trustedOrganizerId?: Id<'organizers'>;
    source?: string;
    reason?: string;
  },
): Promise<Id<'adminAuditLogs'>> {
  return t.run((ctx) => insertAdminAuditLog({db: ctx.db}, args));
}

describe('Admin Audit Logging', () => {
  it('logs admin actions', async () => {
    const t = convexTest();

    // 1. Create Admin
    const adminId = await createRootAdmin(t);
    const admin = t.withIdentity({subject: adminId});

    // 2. Create Regular User
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-audit@example.com',
    });
    const user = t.withIdentity({subject: userId});

    // 3. User submits application
    await user.mutation(api.communities.applications.submit, {
      answers: {why: 'Test'},
    });

    // Get Application ID
    const appId = await t.run(async (ctx) => {
      const app = await ctx.db.query('applications').first();
      return app!._id;
    });

    // 4. Admin reviews application (Approve)
    await admin.mutation(api.communities.applications.review, {
      applicationId: appId,
      status: 'approved',
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', adminId))
        .filter((q) => q.eq(q.field('action'), 'application.review'))
        .collect();
      expect(logs.length).toBe(1);
      expect(logs[0].applicationId).toBe(appId);
    });

    // 5. Admin revokes application
    await admin.mutation(api.communities.applications.revoke, {
      applicationId: appId,
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', adminId))
        .filter((q) => q.eq(q.field('action'), 'application.revoke'))
        .collect();
      expect(logs.length).toBe(1);
      expect(logs[0].applicationId).toBe(appId);
    });

    // 6. Admin creates event
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Test Org',
        slug: 'test-org-audit',
      },
    );
    const eventId = await admin.mutation(api.events.management.create, {
      title: 'Audit Test Event',
      date: '2025-01-01T00:00:00.000Z',
      price: 1000,
      totalTickets: 100,
      status: 'draft',
      visibility: 'private',
      organizerId,
    });

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', adminId))
        .filter((q) => q.eq(q.field('action'), 'event.create'))
        .collect();
      expect(logs.length).toBe(1);
      expect(logs[0].eventId).toBe(eventId);
    });

    // 7. Admin deletes event
    await admin.mutation(api.events.management.remove, {id: eventId});

    await t.run(async (ctx) => {
      const logs = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_adminId', (q) => q.eq('adminId', adminId))
        .filter((q) => q.eq(q.field('action'), 'event.delete'))
        .collect();
      expect(logs.length).toBe(1);
      expect(logs[0].eventId).toBe(eventId);
    });
  });
});

describe('admin_audit.listAuditLogs', () => {
  it('returns audit logs scoped to organizerId', async () => {
    const t = convexTest();

    const orgAId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org A',
    });
    const orgBId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org B',
    });

    const adminId = await createRootAdmin(t, {
      name: 'Admin A',
      email: 'admin-a@example.com',
    });

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
      organizerId: orgAId,
    });
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_UPDATE,
      organizerId: orgBId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgAId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    expect(result.page).toHaveLength(1);
    expect(result.page[0].action).toBe('event.create');
  });

  it('filters by action category', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
      organizerId: orgId,
    });
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.APPLICATION_REVIEW,
      organizerId: orgId,
    });
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUND,
      organizerId: orgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});

    const eventLogs = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        actionCategory: 'event',
        paginationOpts: {numItems: 10, cursor: null},
      },
    );
    expect(eventLogs.page).toHaveLength(1);
    expect(eventLogs.page[0].action).toBe('event.create');

    const appLogs = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        actionCategory: 'application',
        paginationOpts: {numItems: 10, cursor: null},
      },
    );
    expect(appLogs.page).toHaveLength(1);
    expect(appLogs.page[0].action).toBe('application.review');

    const paymentLogs = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        actionCategory: 'payment',
        paginationOpts: {numItems: 10, cursor: null},
      },
    );
    expect(paymentLogs.page).toHaveLength(1);
    expect(paymentLogs.page[0].action).toBe('payment.refund');
  });

  it('fails closed for invalid action categories', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);
    const asAdmin = t.withIdentity({subject: adminId});
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
      organizerId: orgId,
    });

    await expect(
      asAdmin.query(api.communities.management.audit.listAuditLogs, {
        organizerId: orgId,
        actionCategory: 'not-a-real-category' as never,
        paginationOpts: {numItems: 10, cursor: null},
      }),
    ).rejects.toThrow();
  });

  it('filters organizer actions under the role category', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.ORGANIZER_UPDATE,
      organizerId: orgId,
    });
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.ORGANIZER_SET_PLATFORM_ORGANIZER_TRUE,
      organizerId: orgId,
    });
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.COMMUNITY_ADMIN_GRANT,
      organizerId: orgId,
    });
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
      organizerId: orgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});

    const roleLogs = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        actionCategory: 'role',
        paginationOpts: {numItems: 10, cursor: null},
      },
    );
    expect(roleLogs.page).toHaveLength(3);
    const actions = roleLogs.page.map((e: {action: string}) => e.action);
    expect(actions).toContain('organizer.update');
    expect(actions).toContain(
      ADMIN_AUDIT_ACTIONS.ORGANIZER_SET_PLATFORM_ORGANIZER_TRUE,
    );
    expect(actions).toContain(ADMIN_AUDIT_ACTIONS.COMMUNITY_ADMIN_GRANT);
  });

  it('filters by sinceTimestamp', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
      organizerId: orgId,
    });
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_UPDATE,
      organizerId: orgId,
    });

    const firstLogTime = await t.run(async (ctx) => {
      const log = await ctx.db
        .query('adminAuditLogs')
        .withIndex('by_organizer', (q) => q.eq('organizerId', orgId))
        .first();
      return log!._creationTime;
    });

    const asAdmin = t.withIdentity({subject: adminId});

    // All logs at or after the earliest creation time
    const allLogs = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        sinceTimestamp: firstLogTime,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );
    expect(allLogs.page).toHaveLength(2);

    // No logs before the earliest creation time - 1
    const futureLogs = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        sinceTimestamp: firstLogTime + 9999999,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );
    expect(futureLogs.page).toHaveLength(0);

    // All returned logs must satisfy the timestamp filter
    for (const log of allLogs.page) {
      expect(log._creationTime).toBeGreaterThanOrEqual(firstLogTime);
    }
  });

  it('cleans up old audit logs in bounded batches', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);

    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- adminAuditLogs has no production insert mutation; bulk insert required to test cleanup batching
    await t.run(async (ctx) => {
      for (let index = 0; index < 501; index += 1) {
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- adminAuditLogs has no production insert mutation; log entries are side effects
        await ctx.db.insert('adminAuditLogs', {
          adminId,
          action:
            index % 2 === 0
              ? ADMIN_AUDIT_ACTIONS.EVENT_CREATE
              : ADMIN_AUDIT_ACTIONS.EVENT_UPDATE,
          organizerId: orgId,
        });
      }
    });

    const deleted = await t.mutation(
      internal.communities.management.audit.cleanupOldAuditLogs,
      {
        cutoffTimestamp: Date.now() + 60_000,
      },
    );

    expect(deleted).toBe(500);

    const remaining = await t.run(async (ctx) =>
      ctx.db.query('adminAuditLogs').collect(),
    );
    expect(remaining).toHaveLength(1);
  });

  it('stores actionCategory on new audit log writes', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Category Org',
    });
    const adminId = await createRootAdmin(t, {
      name: 'Category Admin',
      email: 'category-admin@example.com',
    });

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
      organizerId: orgId,
    });
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUND,
      organizerId: orgId,
    });

    const logs = await t.run((ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_organizer', (q) => q.eq('organizerId', orgId))
        .collect(),
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
          actionCategory: 'event',
        }),
        expect.objectContaining({
          action: ADMIN_AUDIT_ACTIONS.PAYMENT_REFUND,
          actionCategory: 'payment',
        }),
      ]),
    );
  });

  it('denormalizes admin name from joined users table', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t, {
      name: 'Alice Admin',
      email: 'alice@example.com',
    });

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
      organizerId: orgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    expect(result.page).toHaveLength(1);
    expect(result.page[0].adminName).toBe('Alice Admin');
  });

  it('denormalizes event name from joined events table', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Test Event',
      date: '2030-06-15T00:00:00.000Z',
      price: 2000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_UPDATE,
      eventId,
      organizerId: orgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    expect(result.page).toHaveLength(1);
    expect(result.page[0].eventName).toBe('Test Event');
  });

  it('denormalizes application user name when applicationId is present', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);
    const applicantId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Bob Applicant',
      email: 'bob@example.com',
    });
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- applications insert directly to set status to 'approved'; api.communities.applications.submit creates pending status only
    const applicationId = await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- applications insert directly to set status to approved; api.communities.applications.submit creates pending status only
      ctx.db.insert('applications', {
        userId: applicantId,
        organizerId: orgId,
        status: 'approved',
        answers: {},
      }),
    );

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.APPLICATION_REVIEW,
      applicationId,
      organizerId: orgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    expect(result.page).toHaveLength(1);
    expect(result.page[0].applicationUserName).toBe('Bob Applicant');
  });

  it('denormalizes magicLinkLabel from joined magic_links table', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);
    const {linkId: magicLinkId} = await t.mutation(
      api.testing.magic_links.seedMagicLink,
      {
        createdBy: adminId,
        organizerId: orgId,
        status: 'active',
        token: 'tok_abc123',
        label: 'VIP Backstage Pass',
      },
    );

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.MAGIC_LINK_REDEMPTION,
      magicLinkId,
      organizerId: orgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    expect(result.page).toHaveLength(1);
    expect(result.page[0].magicLinkLabel).toBe('VIP Backstage Pass');
  });

  it('denormalizes trustLinkLabel from organizer ids stored on the audit log', async () => {
    const t = convexTest();

    const trustingOrgId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Trusting Org'},
    );
    const trustedOrgId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Trusted Org'},
    );
    const adminId = await createRootAdmin(t);

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.TRUST_LINK_CREATED,
      organizerId: trustingOrgId,
      trustingOrganizerId: trustingOrgId,
      trustedOrganizerId: trustedOrgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: trustingOrgId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    expect(result.page).toHaveLength(1);
    // trustLinkLabel is derived from both organizer names joined with →
    expect(result.page[0].trustLinkLabel).toBe('Trusting Org → Trusted Org');
  });

  it('excludes logs from other organizers for community admin scope', async () => {
    const t = convexTest();

    const orgAId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org A',
    });
    const orgBId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Org B',
    });

    // Community admin (not root admin) — only has access to orgA
    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Community Admin',
      email: 'cadmin@example.com',
    });
    await grantCommunityAdmin(t, adminId, orgAId);

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
      organizerId: orgAId,
    });
    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_UPDATE,
      organizerId: orgBId,
    });

    const asCommunityAdmin = t.withIdentity({subject: adminId});
    const result = await asCommunityAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgAId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    expect(result.page).toHaveLength(1);
    expect(result.page[0].action).toBe('event.create');
  });

  it('snapshots event title on delete so listAuditLogs still surfaces it', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);
    const asAdmin = t.withIdentity({subject: adminId});

    const eventId = await asAdmin.mutation(api.events.management.create, {
      title: 'Warehouse Party',
      date: '2030-06-15T00:00:00.000Z',
      price: 0,
      totalTickets: 100,
      status: 'draft',
      visibility: 'private',
      organizerId: orgId,
    });

    await asAdmin.mutation(api.events.management.remove, {id: eventId});

    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    const deleteRow = result.page.find(
      (e: {action: string}) => e.action === 'event.delete',
    );
    expect(deleteRow).toBeDefined();
    expect(deleteRow!.eventName).toBeUndefined();
    expect(deleteRow!.deletedEventName).toBe('Warehouse Party');
  });

  it('omits deletedEventName when the event still exists', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });
    const adminId = await createRootAdmin(t);
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Live Event',
      date: '2030-06-15T00:00:00.000Z',
      price: 1000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId: orgId,
    });

    await insertAuditLog(t, {
      adminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_UPDATE,
      eventId,
      organizerId: orgId,
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    expect(result.page).toHaveLength(1);
    expect(result.page[0].eventName).toBe('Live Event');
    expect(result.page[0].deletedEventName).toBeUndefined();
  });

  it('community admin sees actual admin name (not Unknown) for a root admin action', async () => {
    const t = convexTest();

    const orgId = await t.mutation(api.testing.communities.seedOrganizer, {
      name: 'Test Org',
    });

    // Root admin who performed the action — has no application to this community,
    // so RLS-wrapped ctx.db.get() would return null before the fix.
    const rootAdminId = await createRootAdmin(t, {
      name: 'Root Admin',
      email: 'root@example.com',
    });

    // Community admin who is viewing the audit log
    const communityAdminId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Community Admin',
        email: 'cadmin2@example.com',
      },
    );
    await grantCommunityAdmin(t, communityAdminId, orgId);

    await insertAuditLog(t, {
      adminId: rootAdminId,
      action: ADMIN_AUDIT_ACTIONS.EVENT_CREATE,
      organizerId: orgId,
    });

    const asCommunityAdmin = t.withIdentity({subject: communityAdminId});
    const result = await asCommunityAdmin.query(
      api.communities.management.audit.listAuditLogs,
      {
        organizerId: orgId,
        paginationOpts: {numItems: 10, cursor: null},
      },
    );

    expect(result.page).toHaveLength(1);
    // Before the fix, RLS blocked ctx.db.get(rootAdminId) for community admins
    // because the root admin had no application to the community, causing 'Unknown'.
    expect(result.page[0].adminName).toBe('Root Admin');
  });
});
