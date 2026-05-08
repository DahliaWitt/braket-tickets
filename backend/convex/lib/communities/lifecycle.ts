import type {Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {
  listDirectTrustedOrganizers,
  listDirectTrustingOrganizers,
  removeTrustLink,
} from '../../lib/authz';
import {enqueueOrganizerDirectoryRebuild} from '../users/organizer_directory';

type CascadeDb = Pick<MutationCtx['db'], 'query' | 'patch'>;

type OrganizerLifecycleDb = Pick<MutationCtx['db'], 'insert'>;

export async function deleteOrganizerTrustLinks(args: {
  ctx: MutationCtx;
  db: OrganizerLifecycleDb;
  adminId: Id<'users'>;
  organizerId: Id<'organizers'>;
}): Promise<number> {
  const outgoing = await listDirectTrustedOrganizers(args.ctx, args.organizerId);
  const incoming = await listDirectTrustingOrganizers(args.ctx, args.organizerId);
  const uniqueTrustLinks = new Map<
    string,
    {trustingOrganizerId: Id<'organizers'>; trustedOrganizerId: Id<'organizers'>}
  >();

  for (const relation of outgoing) {
    const trustedOrganizerId = relation.objectId as Id<'organizers'>;
    uniqueTrustLinks.set(`${args.organizerId}:${trustedOrganizerId}`, {
      trustingOrganizerId: args.organizerId,
      trustedOrganizerId,
    });
  }

  for (const relation of incoming) {
    const trustingOrganizerId = relation.subjectId as Id<'organizers'>;
    uniqueTrustLinks.set(`${trustingOrganizerId}:${args.organizerId}`, {
      trustingOrganizerId,
      trustedOrganizerId: args.organizerId,
    });
  }

  for (const trustLink of uniqueTrustLinks.values()) {
    await removeTrustLink(
      args.ctx,
      trustLink.trustingOrganizerId,
      trustLink.trustedOrganizerId,
    );
    if (trustLink.trustingOrganizerId !== args.organizerId) {
      await enqueueOrganizerDirectoryRebuild(args.ctx, trustLink.trustingOrganizerId);
    }
    await insertAdminAuditLog({db: args.db}, {
      adminId: args.adminId,
      action: 'trust_link_cascade_deleted',
      trustingOrganizerId: trustLink.trustingOrganizerId,
      trustedOrganizerId: trustLink.trustedOrganizerId,
      organizerId: args.organizerId,
    });
  }

  return uniqueTrustLinks.size;
}

/**
 * When a community transitions to draft, set all its published events to draft
 * and cancel any scheduled marketing emails for those events.
 */
export async function cascadeUnpublishEvents(args: {
  db: CascadeDb;
  scheduler: MutationCtx['scheduler'];
  organizerId: Id<'organizers'>;
}): Promise<number> {
  // Bounded to one organizer's published events (admin operation, not user-scale).
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const publishedEvents = await args.db
    .query('events')
    .withIndex('by_organizer_status', (q) =>
      q.eq('organizerId', args.organizerId).eq('status', 'published'),
    )
    .collect();

  for (const event of publishedEvents) {
    await args.db.patch('events', event._id, {status: 'draft'});

    // Cancel all scheduled marketing emails for this event
    // Bounded to one event's scheduled emails.
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    const scheduledEmails = await args.db
      .query('eventMarketingEmails')
      .withIndex('by_event_and_status', (q) =>
        q.eq('eventId', event._id).eq('status', 'scheduled'),
      )
      .collect();

    for (const email of scheduledEmails) {
      if (email.schedulerJobId) {
        try {
          await args.scheduler.cancel(email.schedulerJobId);
        } catch {
          // Job may have already fired
        }
      }
      await args.db.patch('eventMarketingEmails', email._id, {
        status: 'cancelled',
      });
    }
  }

  return publishedEvents.length;
}
