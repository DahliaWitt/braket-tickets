import type {Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {getAuthUserId, requireUser} from '../../lib/auth_identity';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {
  addTrustLink,
  authz,
  authzUserId,
  listDirectTrustedOrganizers,
  listDirectTrustingOrganizers,
  listOrganizerMembers,
  listOneHopTrustingAccessOrganizers,
  removeTrustLink,
} from '../../lib/authz';
import {requireManageCommunity} from '../../lib/access';
import {resolvePurchaseAccessForUser} from '../../lib/access/purchase';
import {throwAppError} from '../../lib/errors';
import {batchGetStorageUrls} from '../../lib/storage_urls';
import {assertTrustLinkLimit} from '../../lib/trust_links';
import {enqueueOrganizerDirectoryRebuild} from '../../lib/users/organizer_directory';

type AuthCtx = QueryCtx | MutationCtx;

async function assertOrganizerExists(
  ctx: AuthCtx,
  organizerId: Id<'organizers'>,
) {
  const organizer = await ctx.db.get('organizers', organizerId);
  if (!organizer) {
    throwAppError('NOT_FOUND', 'Organizer not found');
  }
  return organizer;
}

export async function createTrustLinkHandler(
  ctx: MutationCtx,
  args: {
    trustingOrganizerId: Id<'organizers'>;
    trustedOrganizerId: Id<'organizers'>;
  },
) {
  const {_id: userId} = await requireUser(ctx);
  await requireManageCommunity(ctx, userId, args.trustingOrganizerId);

  if (args.trustingOrganizerId === args.trustedOrganizerId) {
    throwAppError(
      'INVALID_INPUT',
      'Cannot create a trust link to the same community',
    );
  }

  await Promise.all([
    assertOrganizerExists(ctx, args.trustingOrganizerId),
    assertOrganizerExists(ctx, args.trustedOrganizerId),
  ]);

  const existing = await listDirectTrustedOrganizers(
    ctx,
    args.trustingOrganizerId,
  );
  assertTrustLinkLimit(existing.length + 1);
  if (
    existing.some(
      (relation) => relation.objectId === (args.trustedOrganizerId as string),
    )
  ) {
    throwAppError('CONFLICT', 'Trust link already exists');
  }

  await addTrustLink(ctx, args.trustingOrganizerId, args.trustedOrganizerId, {
    actorId: userId,
  });
  await enqueueOrganizerDirectoryRebuild(ctx, args.trustingOrganizerId);
  await insertAdminAuditLog(ctx, {
    adminId: userId,
    action: 'trust_link_created',
    organizerId: args.trustingOrganizerId,
    trustingOrganizerId: args.trustingOrganizerId,
    trustedOrganizerId: args.trustedOrganizerId,
  });

  return null;
}

export async function removeTrustLinkHandler(
  ctx: MutationCtx,
  args: {
    trustingOrganizerId: Id<'organizers'>;
    trustedOrganizerId: Id<'organizers'>;
  },
) {
  const {_id: userId} = await requireUser(ctx);
  await requireManageCommunity(ctx, userId, args.trustingOrganizerId);

  const existing = await listDirectTrustedOrganizers(
    ctx,
    args.trustingOrganizerId,
  );
  if (
    !existing.some(
      (relation) => relation.objectId === (args.trustedOrganizerId as string),
    )
  ) {
    return null;
  }

  await removeTrustLink(
    ctx,
    args.trustingOrganizerId,
    args.trustedOrganizerId,
    {
      actorId: userId,
    },
  );
  await enqueueOrganizerDirectoryRebuild(ctx, args.trustingOrganizerId);
  await insertAdminAuditLog(ctx, {
    adminId: userId,
    action: 'trust_link_revoked',
    organizerId: args.trustingOrganizerId,
    trustingOrganizerId: args.trustingOrganizerId,
    trustedOrganizerId: args.trustedOrganizerId,
  });

  return null;
}

export async function listTrustLinksHandler(
  ctx: QueryCtx,
  args: {
    organizerId: Id<'organizers'>;
    direction?: 'outgoing' | 'incoming';
  },
) {
  const {_id: userId} = await requireUser(ctx);
  await requireManageCommunity(ctx, userId, args.organizerId);

  const organizer = await assertOrganizerExists(ctx, args.organizerId);
  const direction = args.direction ?? 'outgoing';

  if (direction === 'incoming') {
    const incomingRelations = await listDirectTrustingOrganizers(
      ctx,
      args.organizerId,
    );
    const incomingRows = await Promise.all(
      incomingRelations.map(async (relation) => {
        const trustingOrganizerId = relation.subjectId as Id<'organizers'>;
        const trustingOrganizer = await ctx.db.get(
          'organizers',
          trustingOrganizerId,
        );
        if (!trustingOrganizer) {
          return null;
        }

        return {
          direction,
          trustingOrganizerId,
          trustedOrganizerId: organizer._id,
          trustingOrganizerName: trustingOrganizer.name,
          trustedOrganizerName: organizer.name,
        };
      }),
    );

    return incomingRows.filter(
      (row): row is Exclude<(typeof incomingRows)[number], null> =>
        row !== null,
    );
  }

  const outgoingRelations = await listDirectTrustedOrganizers(
    ctx,
    args.organizerId,
  );
  const outgoingRows = await Promise.all(
    outgoingRelations.map(async (relation) => {
      const trustedOrganizerId = relation.objectId as Id<'organizers'>;
      const [trustedOrganizer, members] = await Promise.all([
        ctx.db.get('organizers', trustedOrganizerId),
        listOrganizerMembers(ctx, trustedOrganizerId),
      ]);
      if (!trustedOrganizer) {
        return null;
      }

      return {
        direction,
        trustingOrganizerId: organizer._id,
        trustedOrganizerId,
        trustingOrganizerName: organizer.name,
        trustedOrganizerName: trustedOrganizer.name,
        trustedMemberCount: members.length,
      };
    }),
  );

  return outgoingRows.filter(
    (row): row is Exclude<(typeof outgoingRows)[number], null> => row !== null,
  );
}

export async function checkUserTrustHandler(
  ctx: QueryCtx,
  args: {
    organizerId: Id<'organizers'>;
  },
) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return {trusted: false, source: null, via: null};
  }

  const access = await resolvePurchaseAccessForUser(
    ctx,
    userId,
    args.organizerId,
  );
  if (!access.allowed) {
    return {trusted: false, source: null, via: null};
  }

  if (access.source === 'shared') {
    const viaOrganizer = await ctx.db.get('organizers', access.viaOrganizerId);
    return {
      trusted: true,
      source: 'shared' as const,
      via: viaOrganizer
        ? {_id: viaOrganizer._id, name: viaOrganizer.name}
        : null,
    };
  }

  return {trusted: true, source: 'direct' as const, via: null};
}

export async function getUserApprovalsHandler(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    return [];
  }

  const userRoles = await authz.getUserRoles(ctx, authzUserId(userId));
  const directOrganizerIds = [
    ...new Set(
      userRoles
        .filter(
          (role) => role.role === 'member' && role.scope?.type === 'organizer',
        )
        .map((role) => role.scope!.id as Id<'organizers'>),
    ),
  ];
  if (directOrganizerIds.length === 0) {
    return [];
  }

  const directOrganizers = await Promise.all(
    directOrganizerIds.map((organizerId) =>
      ctx.db.get('organizers', organizerId),
    ),
  );

  const approvals: Array<{
    organizerId: Id<'organizers'>;
    organizerName: string;
    logoStorageId?: string;
    source: 'direct' | 'shared';
    viaOrganizerId?: Id<'organizers'>;
    viaOrganizerName?: string;
  }> = [];
  const seenOrganizerIds = new Set<Id<'organizers'>>();

  for (let index = 0; index < directOrganizerIds.length; index += 1) {
    const organizer = directOrganizers[index];
    if (!organizer) {
      continue;
    }

    const organizerId = directOrganizerIds[index];
    approvals.push({
      organizerId,
      organizerName: organizer.name,
      logoStorageId: organizer.logoStorageId ?? undefined,
      source: 'direct',
    });
    seenOrganizerIds.add(organizerId);
  }

  for (let index = 0; index < directOrganizerIds.length; index += 1) {
    const viaOrganizer = directOrganizers[index];
    if (!viaOrganizer) {
      continue;
    }

    const trustingOrganizers = await listOneHopTrustingAccessOrganizers(
      ctx,
      viaOrganizer._id,
    );

    for (const organizer of trustingOrganizers) {
      const organizerId = organizer._id;
      if (seenOrganizerIds.has(organizerId)) {
        continue;
      }

      approvals.push({
        organizerId,
        organizerName: organizer.name,
        logoStorageId: organizer.logoStorageId ?? undefined,
        source: 'shared',
        viaOrganizerId: viaOrganizer._id,
        viaOrganizerName: viaOrganizer.name,
      });
      seenOrganizerIds.add(organizerId);
    }
  }

  const logoUrlMap = await batchGetStorageUrls(
    ctx,
    approvals.map((a) => a.logoStorageId),
  );

  return approvals.map(({logoStorageId, ...approval}) => ({
    ...approval,
    organizerLogoUrl: logoStorageId
      ? (logoUrlMap.get(logoStorageId) ?? undefined)
      : undefined,
  }));
}
