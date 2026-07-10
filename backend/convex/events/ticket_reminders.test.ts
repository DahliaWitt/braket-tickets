import {describe, expect, it} from 'vitest';
import {convexTest} from '../setup.testing';
import {api} from '../_generated/api';
import {loadTicketReminderRecipients} from './_impl/reminders';

/**
 * Seeds the common send-path setup shared by the rich-body reminder tests: a
 * root admin sender, an organizer community, a recipient user with an approved
 * application (so they qualify as an `approved_no_ticket` recipient), and a
 * published public event. Returns the seeded ids plus an admin-identity handle.
 * Each test supplies its own unique emails/title/date and asserts its own
 * body/persistence behavior.
 */
async function seedApprovedRecipientFixture(
  t: ReturnType<typeof convexTest>,
  opts: {
    adminEmail: string;
    recipientEmail: string;
    eventTitle: string;
    eventDate: string;
  },
) {
  const adminId = await t.mutation(api.testing.users.createUserDirectly, {
    name: 'Admin',
    email: opts.adminEmail,
    isRootAdmin: true,
  });
  const organizerId = await t.mutation(api.testing.communities.seedOrganizer, {
    name: 'Community',
  });
  const recipientUserId = await t.mutation(
    api.testing.users.createUserDirectly,
    {name: 'Recipient User', email: opts.recipientEmail},
  );
  const eventId = await t.mutation(api.testing.events.seedEvent, {
    title: opts.eventTitle,
    date: opts.eventDate,
    price: 3000,
    totalTickets: 80,
    status: 'published',
    visibility: 'public',
    organizerId,
  });
  await t.run(async (ctx) =>
    // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
    ctx.db.insert('applications', {
      userId: recipientUserId,
      organizerId,
      status: 'approved',
      answers: {},
    }),
  );
  const asAdmin = t.withIdentity({subject: adminId});
  return {adminId, organizerId, recipientUserId, eventId, asAdmin};
}

describe('Event Ticket Reminder Audience', () => {
  it('returns all approved community members without completed/refunded purchases for selected event', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-reminder@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Main Community',
      },
    );
    const otherOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Other Community',
      },
    );

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Reminder Event',
      date: '2026-06-01T02:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const includedUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Included User',
        email: 'included@example.com',
      },
    );
    const completedUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Completed User',
        email: 'completed@example.com',
      },
    );
    const refundedUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Refunded User',
        email: 'refunded@example.com',
      },
    );
    const wrongOrganizerUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Wrong Organizer User',
        email: 'wrong-organizer@example.com',
      },
    );
    const notTrustedUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Not Trusted User',
        email: 'not-trusted@example.com',
      },
    );
    const pendingUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Pending User',
        email: 'pending@example.com',
      },
    );

    await t.run(async (ctx) => {
      // createUserDirectly requires a non-empty email; this user must have no email so
      // hasEmail() filters them out of the recipient list.
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- createUserDirectly requires email; must create user without email to test hasEmail filter
      const missingEmailUserId = await ctx.db.insert('users', {
        name: 'No Email User',
      });

      await Promise.all([
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications; applications.submit is member-facing and requires specific session setup
        ctx.db.insert('applications', {
          userId: includedUserId,
          organizerId,
          status: 'approved',
          answers: {},
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
        ctx.db.insert('applications', {
          userId: completedUserId,
          organizerId,
          status: 'approved',
          answers: {},
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
        ctx.db.insert('applications', {
          userId: refundedUserId,
          organizerId,
          status: 'approved',
          answers: {},
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
        ctx.db.insert('applications', {
          userId: wrongOrganizerUserId,
          organizerId: otherOrganizerId,
          status: 'approved',
          answers: {},
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
        ctx.db.insert('applications', {
          userId: notTrustedUserId,
          organizerId,
          status: 'approved',
          answers: {},
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
        ctx.db.insert('applications', {
          userId: missingEmailUserId,
          organizerId,
          status: 'approved',
          answers: {},
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
        ctx.db.insert('applications', {
          userId: pendingUserId,
          organizerId,
          status: 'pending',
          answers: {},
        }),
      ]);

      const now = Date.now();
      await Promise.all([
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for orders; needed to simulate users who already purchased
        ctx.db.insert('ticket_orders', {
          userId: completedUserId,
          eventId,
          kind: 'primary',
          amountCents: 1500,
          currency: 'USD',
          state: 'completed',
          quantity: 1,
          tier: 'regular',
          expiresAt: now,
          completedAt: now,
          trustSource: 'open_access',
        }),
        // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- see above
        ctx.db.insert('ticket_orders', {
          userId: refundedUserId,
          eventId,
          kind: 'primary',
          amountCents: 1500,
          currency: 'USD',
          state: 'completed',
          quantity: 1,
          tier: 'regular',
          expiresAt: now,
          completedAt: now,
          trustSource: 'open_access',
        }),
      ]);
    });

    const asAdmin = t.withIdentity({subject: adminId});
    const audience = await asAdmin.query(
      api.events.reminders.getTicketReminderAudience,
      {
        eventId,
      },
    );

    expect(audience.segment).toBe('approved_no_ticket');
    // Approximate count: includes the no-email user because countTicketReminderRecipients
    // skips email/preference checks — those happen only at send time.
    expect(audience.recipientCount).toBe(3);
    expect(audience.missingOrganizer).toBe(false);
  });

  it('returns zero recipients when event has no organizer', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-no-org@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community',
      },
    );
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Recipient User',
        email: 'recipient@example.com',
      },
    );

    // Platform organizer event — no community associated
    const platformOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Platform Org',
        slug: 'platform-org',
        isPlatformOrganizer: true,
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'No Community Event',
      date: '2026-06-02T02:00:00.000Z',
      price: 2000,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId: platformOrganizerId,
    });

    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    const asAdmin = t.withIdentity({subject: adminId});
    const audience = await asAdmin.query(
      api.events.reminders.getTicketReminderAudience,
      {
        eventId,
      },
    );

    expect(audience.segment).toBe('approved_no_ticket');
    expect(audience.recipientCount).toBe(0);
    expect(audience.missingOrganizer).toBe(false);
  });

  it('rejects non-admin users for audience query', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-audience-q@test-reminders.com',
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Unauthorized Event',
      date: '2026-06-03T02:00:00.000Z',
      price: 1000,
      totalTickets: 20,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const asUser = t.withIdentity({subject: userId});
    await expect(
      asUser.query(api.events.reminders.getTicketReminderAudience, {eventId}),
    ).rejects.toThrow('Unauthorized');
  });

  it('rejects non-admin users for send mutation', async () => {
    const t = convexTest();

    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Regular User',
      email: 'regular-send-rem@test-reminders.com',
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Unauthorized Send Event',
      date: '2026-06-03T02:00:00.000Z',
      price: 1000,
      totalTickets: 20,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const asUser = t.withIdentity({subject: userId});
    await expect(
      asUser.mutation(api.events.reminders.sendTicketPurchaseReminder, {
        eventId,
        subject: 'Reminder subject',
        message: 'Reminder message',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('sends zero reminders when event has no organizer', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-send-no-org@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community',
      },
    );
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Recipient User',
        email: 'recipient@example.com',
      },
    );

    const platformOrganizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Platform Org',
        slug: 'platform-org',
        isPlatformOrganizer: true,
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'No Community Send Event',
      date: '2026-06-03T02:00:00.000Z',
      price: 1000,
      totalTickets: 20,
      status: 'published',
      visibility: 'public',
      organizerId: platformOrganizerId,
    });

    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Reminder subject',
        message: 'Reminder message',
      },
    );

    expect(result.segment).toBe('approved_no_ticket');
    expect(result.recipientCount).toBe(0);
  });

  it('sends reminder and writes audit log entry', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-send-audit@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Community',
      },
    );
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Recipient User',
        email: 'recipient@example.com',
      },
    );

    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Send Reminder Event',
      date: '2026-06-04T02:00:00.000Z',
      price: 3000,
      totalTickets: 80,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    const asAdmin = t.withIdentity({subject: adminId});
    const result = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Last call for tickets',
        message: 'You were approved and can now purchase your ticket.',
      },
    );

    expect(result.segment).toBe('approved_no_ticket');
    expect(result.recipientCount).toBe(1);

    const auditLog = await t.run(async (ctx) =>
      ctx.db
        .query('adminAuditLogs')
        .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
        .order('desc')
        .first(),
    );

    expect(auditLog?.adminId).toBe(adminId);
    expect(auditLog?.action).toBe(
      'event.reminder-email.send.approved_no_ticket',
    );
    expect(auditLog?.source).toBe('admin-ui');
  });

  it('validates + renders bodyJson, stores it, derives plain text, and sends rich HTML', async () => {
    const t = convexTest();

    const {eventId, asAdmin} = await seedApprovedRecipientFixture(t, {
      adminEmail: 'admin-send-rich@test-reminders.com',
      recipientEmail: 'rich-recipient@example.com',
      eventTitle: 'Rich Reminder Event',
      eventDate: '2026-06-04T02:00:00.000Z',
    });

    const bodyJson = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {type: 'text', text: 'Last ', marks: [{type: 'italic'}]},
            {type: 'text', text: 'call'},
          ],
        },
      ],
    });

    const result = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Last call for tickets',
        message: 'client-supplied-should-be-ignored',
        bodyJson,
      },
    );

    expect(result.recipientCount).toBe(1);

    const send = await t.run(async (ctx) =>
      ctx.db
        .query('ticketReminderSends')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    // Stored bodyJson is the SANITIZED document (structurally equal for a
    // clean input; raw client strings are never persisted).
    expect(JSON.parse(send?.bodyJson ?? 'null')).toEqual(JSON.parse(bodyJson));
    expect(send?.message).toContain('Last call');
    expect(send?.message).not.toContain('client-supplied-should-be-ignored');

    const capturedPayloads = await t.query(api.testing.email.getSentEmails, {
      to: 'rich-recipient@example.com',
    });
    const payload = capturedPayloads[0] as {
      html?: string;
      text?: string;
    } | null;
    expect(payload?.html).toContain('<em');
    expect(payload?.text).toContain('Last call');
  });

  it('throws for a forged image src with no storageId (arbitrary remote host)', async () => {
    const t = convexTest();

    const {eventId, asAdmin} = await seedApprovedRecipientFixture(t, {
      adminEmail: 'admin-send-rich-bad@test-reminders.com',
      recipientEmail: 'rich-bad-recipient@example.com',
      eventTitle: 'Rich Reminder Bad Event',
      eventDate: '2026-06-05T02:00:00.000Z',
    });

    await expect(
      asAdmin.mutation(api.events.reminders.sendTicketPurchaseReminder, {
        eventId,
        subject: 'Bad image',
        message: 'fallback',
        bodyJson: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: {src: 'https://attacker.example/pixel.png'},
            },
          ],
        }),
      }),
    ).rejects.toThrow();

    const sends = await t.run(async (ctx) =>
      ctx.db
        .query('ticketReminderSends')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(sends).toHaveLength(0);
  });

  it('throws for an image whose storageId is not a confirmed upload', async () => {
    const t = convexTest();

    const {eventId, asAdmin} = await seedApprovedRecipientFixture(t, {
      adminEmail: 'admin-send-unconfirmed@test-reminders.com',
      recipientEmail: 'unconfirmed-recipient@example.com',
      eventTitle: 'Unconfirmed Image Event',
      eventDate: '2026-06-06T02:00:00.000Z',
    });

    // A stored-but-never-confirmed storage id must be rejected.
    const unconfirmed = await t.run(async (ctx) => {
      const blob = new Blob(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer as ArrayBuffer],
        {type: 'image/png'},
      );
      return await ctx.storage.store(blob);
    });

    await expect(
      asAdmin.mutation(api.events.reminders.sendTicketPurchaseReminder, {
        eventId,
        subject: 'Forged id',
        message: 'fallback',
        bodyJson: JSON.stringify({
          type: 'doc',
          content: [{type: 'image', attrs: {storageId: unconfirmed, alt: 'x'}}],
        }),
      }),
    ).rejects.toThrow();

    const sends = await t.run(async (ctx) =>
      ctx.db
        .query('ticketReminderSends')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(sends).toHaveLength(0);
  });

  it('renders a confirmed image through the durable /api/images route', async () => {
    const t = convexTest();

    const {eventId, asAdmin} = await seedApprovedRecipientFixture(t, {
      adminEmail: 'admin-send-confirmed@test-reminders.com',
      recipientEmail: 'confirmed-recipient@example.com',
      eventTitle: 'Confirmed Image Event',
      eventDate: '2026-06-07T02:00:00.000Z',
    });

    const storageId = await t.run(async (ctx) => {
      const blob = new Blob(
        [
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            .buffer as ArrayBuffer,
        ],
        {type: 'image/png'},
      );
      return await ctx.storage.store(blob);
    });
    const confirm = await asAdmin.action(api.storage.files.confirmUpload, {
      storageId,
      mimeType: 'image/png',
    });
    expect(confirm.valid).toBe(true);

    const result = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Confirmed image',
        message: 'fallback',
        // Smuggle preview-only / hostile extra attrs alongside the storageId:
        // the validator ignores them for rendering, and persistence must strip
        // them from the stored bodyJson.
        bodyJson: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'image',
              attrs: {
                storageId,
                alt: 'flyer',
                src: 'https://signed.example/preview?sig=SECRET',
                onerror: 'alert(1)',
              },
            },
          ],
        }),
      },
    );
    expect(result.recipientCount).toBe(1);

    const capturedPayloads = await t.query(api.testing.email.getSentEmails, {
      to: 'confirmed-recipient@example.com',
    });
    const payload = capturedPayloads[0] as {html?: string} | null;
    expect(payload?.html).toContain(
      `/api/images/${encodeURIComponent(storageId)}`,
    );
    expect(payload?.html).not.toContain('attacker');
    const signedPreviewUrl = await t.run((ctx) =>
      ctx.storage.getUrl(storageId),
    );
    expect(signedPreviewUrl).toBeTruthy();
    expect(payload?.html).not.toContain(signedPreviewUrl as string);

    // Persistence regression: the stored bodyJson is the SANITIZED document —
    // the smuggled signed preview src and onerror attrs must not survive.
    const storedSend = await t.run(async (ctx) =>
      ctx.db
        .query('ticketReminderSends')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );
    expect(storedSend?.bodyJson).toContain(storageId);
    expect(storedSend?.bodyJson).not.toContain('signed.example');
    expect(storedSend?.bodyJson).not.toContain('onerror');
    expect(storedSend?.bodyJson).not.toContain('"src"');
  });

  it('throws for a body that renders past the amplification cap', async () => {
    const t = convexTest();

    const {eventId, asAdmin} = await seedApprovedRecipientFixture(t, {
      adminEmail: 'admin-send-amplified@test-reminders.com',
      recipientEmail: 'amplified-recipient@example.com',
      eventTitle: 'Amplified Reminder Event',
      eventDate: '2026-06-09T02:00:00.000Z',
    });

    await expect(
      asAdmin.mutation(api.events.reminders.sendTicketPurchaseReminder, {
        eventId,
        subject: 'Amplified',
        message: 'fallback',
        bodyJson: JSON.stringify({
          type: 'doc',
          content: [
            {type: 'paragraph', content: [{type: 'text', text: 'x'}]},
            ...Array.from({length: 250}, () => ({type: 'paragraph'})),
          ],
        }),
      }),
    ).rejects.toThrow();

    const sends = await t.run(async (ctx) =>
      ctx.db
        .query('ticketReminderSends')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(sends).toHaveLength(0);
  });

  it('throws for an image confirmed by a different user (ownership)', async () => {
    const t = convexTest();

    const {eventId, asAdmin} = await seedApprovedRecipientFixture(t, {
      adminEmail: 'admin-send-owned@test-reminders.com',
      recipientEmail: 'owned-recipient@example.com',
      eventTitle: 'Owned Image Event',
      eventDate: '2026-06-08T02:00:00.000Z',
    });

    // A DIFFERENT user confirms the upload; the admin sender does not own it.
    const otherId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Other Uploader',
      email: 'other-uploader@test-reminders.com',
    });
    const asOther = t.withIdentity({subject: otherId});
    const storageId = await t.run(async (ctx) => {
      const blob = new Blob(
        [
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            .buffer as ArrayBuffer,
        ],
        {type: 'image/png'},
      );
      return await ctx.storage.store(blob);
    });
    const confirm = await asOther.action(api.storage.files.confirmUpload, {
      storageId,
      mimeType: 'image/png',
    });
    expect(confirm.valid).toBe(true);

    await expect(
      asAdmin.mutation(api.events.reminders.sendTicketPurchaseReminder, {
        eventId,
        subject: 'Not my image',
        message: 'fallback',
        bodyJson: JSON.stringify({
          type: 'doc',
          content: [{type: 'image', attrs: {storageId, alt: 'x'}}],
        }),
      }),
    ).rejects.toThrow();

    const sends = await t.run(async (ctx) =>
      ctx.db
        .query('ticketReminderSends')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .collect(),
    );
    expect(sends).toHaveLength(0);
  });

  it('excludes users who have opted out of marketing emails', async () => {
    const t = convexTest();

    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Opt-Out Community',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Opt-Out Reminder Event',
      date: '2026-06-10T02:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const baselineUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Baseline User',
        email: 'baseline@example.com',
      },
    );
    const globalOptOutUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Global Opt-Out User',
        email: 'global-optout@example.com',
      },
    );
    const perOrganizerOptOutUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {name: 'Per-Organizer Opt-Out User', email: 'per-org-optout@example.com'},
    );
    const addressOptOutUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {name: 'Address Opt-Out User', email: 'address-optout@example.com'},
    );
    // User whose address pref is opted-in but whose user pref is opted-out.
    // Verifies user-level opt-out still excludes when address pref is positive —
    // i.e., a positive address pref does NOT override a negative user pref.
    const userOptOutWithAddressInUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'User Opt-Out With Address Opt-In User',
        email: 'user-optout-addr-optin@example.com',
      },
    );

    const applicationUserIds: (typeof baselineUserId)[] = [
      baselineUserId,
      globalOptOutUserId,
      perOrganizerOptOutUserId,
      addressOptOutUserId,
      userOptOutWithAddressInUserId,
    ];

    await t.run(async (ctx) => {
      await Promise.all(
        applicationUserIds.map((userId) =>
          // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications; approved-without-ticket seeding
          ctx.db.insert('applications', {
            userId,
            organizerId,
            status: 'approved',
            answers: {},
          }),
        ),
      );

      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production mutation for globalMarketingOptOut toggle
      await ctx.db.patch('users', globalOptOutUserId, {
        globalMarketingOptOut: true,
      });
    });

    await t.mutation(api.testing.marketing.seedMarketingPreference, {
      userId: perOrganizerOptOutUserId,
      organizerId,
      optedIn: false,
      unsubToken: 'per-org-optout-token',
    });
    await t.mutation(api.testing.marketing.seedAddressMarketingPreference, {
      email: 'address-optout@example.com',
      organizerId,
      optedIn: false,
      unsubToken: 'addr-optout-token',
    });
    // Precedence tie-breaker: address pref is positive, user pref is negative.
    // User pref must still exclude — "address takes precedence" only applies when
    // the address pref is negative (matches broadcasts.ts shouldIncludeUser).
    await t.mutation(api.testing.marketing.seedMarketingPreference, {
      userId: userOptOutWithAddressInUserId,
      organizerId,
      optedIn: false,
      unsubToken: 'user-optout-addr-in-user-token',
    });
    await t.mutation(api.testing.marketing.seedAddressMarketingPreference, {
      email: 'user-optout-addr-optin@example.com',
      organizerId,
      optedIn: true,
      unsubToken: 'user-optout-addr-in-addr-token',
    });

    const {recipients} = await t.run((ctx) =>
      loadTicketReminderRecipients(ctx, eventId),
    );
    const recipientUserIds = new Set(recipients.map((r) => r.userId));

    expect(recipientUserIds.has(baselineUserId)).toBe(true);
    expect(recipientUserIds.has(globalOptOutUserId)).toBe(false);
    expect(recipientUserIds.has(perOrganizerOptOutUserId)).toBe(false);
    expect(recipientUserIds.has(addressOptOutUserId)).toBe(false);
    expect(recipientUserIds.has(userOptOutWithAddressInUserId)).toBe(false);
    expect(recipients).toHaveLength(1);
  });
});

describe('Ticket Reminder Dedup', () => {
  it('blocks duplicate send with identical subject', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-dedup@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Dedup Community',
      },
    );
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Recipient',
        email: 'dedup-recipient@example.com',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Dedup Event',
      date: '2026-07-01T02:00:00.000Z',
      price: 1500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    const asAdmin = t.withIdentity({subject: adminId});
    const first = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Dedup subject',
        message: 'First send',
      },
    );
    expect(first.recipientCount).toBe(1);

    const second = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Dedup subject',
        message: 'Second send same subject',
      },
    );
    expect(second.recipientCount).toBe(0);
  });

  it('allows send with different subject (different dedup key)', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-dedup-diff@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Dedup Diff Community',
      },
    );
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Recipient',
        email: 'dedup-diff-recipient@example.com',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Dedup Diff Event',
      date: '2026-07-02T02:00:00.000Z',
      price: 1500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    const asAdmin = t.withIdentity({subject: adminId});
    const first = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Subject A',
        message: 'First send',
      },
    );
    expect(first.recipientCount).toBe(1);

    // Different subject produces a different dedup key, but same rate-limit key.
    // Rate limiter (1 per 15 min) blocks the second send.
    await expect(
      asAdmin.mutation(api.events.reminders.sendTicketPurchaseReminder, {
        eventId,
        subject: 'Subject B',
        message: 'Second send different subject',
      }),
    ).rejects.toThrow();
  });
});

describe('Ticket Reminder Rate Limiting', () => {
  it('blocks rapid successive sends to the same event', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-ratelimit@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Rate Limit Community',
      },
    );
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Recipient',
        email: 'ratelimit-recipient@example.com',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Rate Limit Event',
      date: '2026-07-03T02:00:00.000Z',
      price: 1500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    const asAdmin = t.withIdentity({subject: adminId});
    const first = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Rate limit test',
        message: 'First send',
      },
    );
    expect(first.recipientCount).toBe(1);

    // Second send with different subject bypasses dedup but hits rate limiter
    await expect(
      asAdmin.mutation(api.events.reminders.sendTicketPurchaseReminder, {
        eventId,
        subject: 'Rate limit test 2',
        message: 'Second send',
      }),
    ).rejects.toThrow();
  });

  it('dedup early-return does not consume rate-limit budget', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-dedup-rl@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Dedup RL Community',
      },
    );
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Recipient',
        email: 'dedup-rl-recipient@example.com',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Dedup RL Event',
      date: '2026-07-04T02:00:00.000Z',
      price: 1500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    const asAdmin = t.withIdentity({subject: adminId});

    // First send succeeds (consumes 1 rate-limit token)
    await asAdmin.mutation(api.events.reminders.sendTicketPurchaseReminder, {
      eventId,
      subject: 'Dedup RL subject',
      message: 'Initial send',
    });

    // Retry with same subject: dedup read returns early BEFORE rate limiter,
    // so this should NOT throw even though the rate-limit budget is exhausted
    const retry = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Dedup RL subject',
        message: 'Retry same subject',
      },
    );
    expect(retry.recipientCount).toBe(0);
  });
});

describe('Zero-Recipient Dedup Preservation', () => {
  it('does not burn dedup slot when audience is empty', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-zero@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Zero Recipient Community',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Zero Recipient Event',
      date: '2026-07-05T02:00:00.000Z',
      price: 1500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    const asAdmin = t.withIdentity({subject: adminId});

    // Send with no approved members — should return 0 WITHOUT burning dedup
    const empty = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Zero test',
        message: 'No recipients yet',
      },
    );
    expect(empty.recipientCount).toBe(0);

    // Verify no dedup row was inserted
    const dedupCount = await t.run(async (ctx) => {
      const rows = await ctx.db.query('emailDedup').collect();
      return rows.filter((r) => r.key.includes(eventId)).length;
    });
    expect(dedupCount).toBe(0);

    // Now add a recipient and send again with same subject — should succeed
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Late Recipient',
        email: 'late-recipient@example.com',
      },
    );
    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    const retry = await asAdmin.mutation(
      api.events.reminders.sendTicketPurchaseReminder,
      {
        eventId,
        subject: 'Zero test',
        message: 'Now has recipients',
      },
    );
    expect(retry.recipientCount).toBe(1);
  });
});

describe('Send History Recording', () => {
  it('records send history in ticketReminderSends', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-history@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'History Community',
      },
    );
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Recipient',
        email: 'history-recipient@example.com',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'History Event',
      date: '2026-07-06T02:00:00.000Z',
      price: 1500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.events.reminders.sendTicketPurchaseReminder, {
      eventId,
      subject: 'History subject',
      message: 'History message body',
    });

    const history = await t.run(async (ctx) =>
      ctx.db
        .query('ticketReminderSends')
        .withIndex('by_event', (q) => q.eq('eventId', eventId))
        .first(),
    );

    expect(history).not.toBeNull();
    expect(history!.adminId).toBe(adminId);
    expect(history!.subject).toBe('History subject');
    expect(history!.message).toBe('History message body');
    expect(history!.recipientCount).toBe(1);
    expect(history!.sentAt).toBeGreaterThan(0);
  });
});

describe('Unsub Token Generation', () => {
  it('creates marketing preference rows during send', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: 'admin-unsub@test-reminders.com',
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {
        name: 'Unsub Community',
      },
    );
    const recipientUserId = await t.mutation(
      api.testing.users.createUserDirectly,
      {
        name: 'Recipient',
        email: 'unsub-recipient@example.com',
      },
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Unsub Event',
      date: '2026-07-07T02:00:00.000Z',
      price: 1500,
      totalTickets: 50,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    await t.run(async (ctx) =>
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications
      ctx.db.insert('applications', {
        userId: recipientUserId,
        organizerId,
        status: 'approved',
        answers: {},
      }),
    );

    // Confirm no marketing preference exists yet
    const prefBefore = await t.run(async (ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', recipientUserId).eq('organizerId', organizerId),
        )
        .first(),
    );
    expect(prefBefore).toBeNull();

    const asAdmin = t.withIdentity({subject: adminId});
    await asAdmin.mutation(api.events.reminders.sendTicketPurchaseReminder, {
      eventId,
      subject: 'Unsub test',
      message: 'Check preference creation',
    });

    const prefAfter = await t.run(async (ctx) =>
      ctx.db
        .query('marketingEmailPreferences')
        .withIndex('by_user_and_organizer', (q) =>
          q.eq('userId', recipientUserId).eq('organizerId', organizerId),
        )
        .first(),
    );

    expect(prefAfter).not.toBeNull();
    expect(prefAfter!.unsubToken).toBeUndefined();
    expect(prefAfter!.unsubTokenDigest).toBeTruthy();
    expect(prefAfter!.unsubTokenPrefix).toBeTruthy();
    expect(prefAfter!.optedIn).toBe(true);
  });
});

describe('Ticket Reminder Audience — imported entries excluded', () => {
  it('imported ticket holders never enter the approved-without-ticket segment', async () => {
    const t = convexTest();

    const adminId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Admin',
      email: `admin-imp-reminder-${Date.now()}@test-reminders.com`,
      isRootAdmin: true,
    });
    const organizerId = await t.mutation(
      api.testing.communities.seedOrganizer,
      {name: 'Reminder Community'},
    );
    const eventId = await t.mutation(api.testing.events.seedEvent, {
      title: 'Reminder Event',
      date: '2026-06-01T02:00:00.000Z',
      price: 1500,
      totalTickets: 100,
      status: 'published',
      visibility: 'public',
      organizerId,
    });

    // One approved member without a ticket → the baseline audience.
    const memberId = await t.mutation(api.testing.users.createUserDirectly, {
      name: 'Approved Member',
      email: 'member@example.com',
    });
    await t.run(async (ctx) => {
      // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- no production composite for applications; mirrors the existing reminder-audience tests
      await ctx.db.insert('applications', {
        userId: memberId,
        organizerId,
        status: 'approved',
        answers: {},
      });
    });

    const asAdmin = t.withIdentity({subject: adminId});

    const audienceBefore = await asAdmin.query(
      api.events.reminders.getTicketReminderAudience,
      {eventId},
    );
    expect(audienceBefore.segment).toBe('approved_no_ticket');
    expect(audienceBefore.recipientCount).toBe(1);

    // Import external ticket holders WITH emails (including one whose email
    // matches the approved member — must NOT create a duplicate or linkage).
    await asAdmin.mutation(api.events.imported_tickets.importBatch, {
      eventId,
      batchKey: 'reminder-imp-1',
      dedupMode: 'skip',
      sourceLabel: 'RA',
      rows: [
        {name: 'Ext One', email: 'ext-one@example.com', externalRef: 'R1'},
        {name: 'Ext Two', email: 'ext-two@example.com', externalRef: 'R2'},
        // Same email as the approved member — inert, unlinked.
        {name: 'Ext Member', email: 'member@example.com', externalRef: 'R3'},
      ],
    });

    // The reminder audience count is UNCHANGED — imported entries are inert,
    // unlinked records with no membership, so they cannot match the
    // member-based segment.
    const audienceAfter = await asAdmin.query(
      api.events.reminders.getTicketReminderAudience,
      {eventId},
    );
    expect(audienceAfter.recipientCount).toBe(1);

    // The resolved recipient list contains ONLY the approved member — none of
    // the imported emails leak into the reminder send audience.
    const {recipients} = await t.run(async (ctx) =>
      loadTicketReminderRecipients(ctx, eventId),
    );
    const emails = recipients.map((r) => r.email.toLowerCase());
    expect(emails).toEqual(['member@example.com']);
    expect(emails).not.toContain('ext-one@example.com');
    expect(emails).not.toContain('ext-two@example.com');
  });
});
