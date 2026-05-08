import type {Doc, Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {getLatestApplicationForOrganizer} from '../applications/read_models';
import {stripSensitiveUserFields} from './helpers';
import {
  authz,
  authzUserId,
  listDirectTrustedOrganizers,
  listOrganizerMembers,
  organizerScope,
  paginateTrustingOrganizerIds,
} from '../../lib/authz';
import {batchGetUsers} from '../../lib/batch_utils';
import {collectAllQueryUnsafe} from '../../lib/query_scan';
import {assertTrustLinkLimit} from '../../lib/trust_links';

type DirectoryCtx = QueryCtx | MutationCtx;

type UserApplicationRow = {
  user: ReturnType<typeof stripSensitiveUserFields>;
  application: {
    _id: Id<'applications'>;
    _creationTime: number;
    userId: Id<'users'>;
    organizerId?: Id<'organizers'>;
    status: Doc<'applications'>['status'];
    processedBy?: Id<'users'>;
    reason?: string;
    answers: Doc<'applications'>['answers'];
  } | null;
  isCommunityAdmin?: boolean;
  communityAccessSource?:
    | 'approved_application'
    | 'magic_link'
    | 'direct_member'
    | 'shared';
  trustedViaOrganizerName?: string;
};

type UserApplicationPage = {
  page: UserApplicationRow[];
  isDone: boolean;
  continueCursor: string;
};

type DirectoryEntryDoc = Doc<'organizer_user_directory'>;
type DirectoryEntryFields = Omit<
  Doc<'organizer_user_directory'>,
  '_id' | '_creationTime'
>;
type DirectoryRebuildDoc = Doc<'organizer_user_directory_rebuilds'>;
type MembershipPropagationDoc =
  Doc<'organizer_user_directory_membership_propagations'>;

type DirectoryApplicationSnapshot = {
  applicationId?: Id<'applications'>;
  applicationCreationTime?: number;
  applicationStatus?: Doc<'applications'>['status'];
  applicationProcessedBy?: Id<'users'>;
  applicationReason?: string;
  applicationAnswers?: Doc<'applications'>['answers'];
};

const ORGANIZER_DIRECTORY_REBUILD_BATCH_SIZE = 50;
const TRUSTING_ORGANIZER_PROPAGATION_BATCH_SIZE = 50;

async function getTrustedViaOrganizerName(
  ctx: DirectoryCtx,
  organizerId: Id<'organizers'>,
  userId: Id<'users'>,
): Promise<string | undefined> {
  const trustedOrganizerRelations = await listDirectTrustedOrganizers(
    ctx,
    organizerId,
  );
  const trustedOrganizers = (
    await Promise.all(
      trustedOrganizerRelations.map((relation) =>
        ctx.db.get('organizers', relation.objectId as Id<'organizers'>),
      ),
    )
  ).filter((organizer): organizer is Doc<'organizers'> => organizer !== null);

  for (const trustedOrganizer of trustedOrganizers) {
    const isTrustedMember = await authz.hasRole(
      ctx,
      authzUserId(userId),
      'member',
      organizerScope(trustedOrganizer._id),
    );
    if (isTrustedMember) {
      return trustedOrganizer.name;
    }
  }

  return undefined;
}

async function hasOrganizerMagicLinkRedemption(
  ctx: DirectoryCtx,
  organizerId: Id<'organizers'>,
  userId: Id<'users'>,
): Promise<boolean> {
  const redemptions = await collectAllQueryUnsafe(
    ctx.db
      .query('magic_link_redemption_log')
      .withIndex('by_user', (query) => query.eq('userId', userId)),
  );
  const links = await Promise.all(
    redemptions.map((redemption) =>
      ctx.db.get('magic_links', redemption.magicLinkId),
    ),
  );
  return links.some((link) => link?.organizerId === organizerId);
}

function toDirectoryApplicationSnapshot(
  application: Doc<'applications'> | null,
): DirectoryApplicationSnapshot {
  if (!application) {
    return {};
  }

  return {
    applicationId: application._id,
    applicationCreationTime: application._creationTime,
    applicationStatus: application.status,
    applicationProcessedBy: application.processedBy,
    applicationReason: application.reason ?? application.denyReason,
    applicationAnswers: application.answers,
  };
}

async function findDirectoryEntry(
  ctx: MutationCtx,
  organizerId: Id<'organizers'>,
  userId: Id<'users'>,
): Promise<DirectoryEntryDoc | null> {
  return await ctx.db
    .query('organizer_user_directory')
    .withIndex('by_organizer_and_user', (query) =>
      query.eq('organizerId', organizerId).eq('userId', userId),
    )
    .unique();
}

async function findDirectoryRebuild(
  ctx: Pick<MutationCtx, 'db'>,
  organizerId: Id<'organizers'>,
): Promise<DirectoryRebuildDoc | null> {
  return await ctx.db
    .query('organizer_user_directory_rebuilds')
    .withIndex('by_organizer', (query) => query.eq('organizerId', organizerId))
    .unique();
}

async function findMembershipPropagation(
  ctx: Pick<MutationCtx, 'db'>,
  organizerId: Id<'organizers'>,
  userId: Id<'users'>,
): Promise<MembershipPropagationDoc | null> {
  return await ctx.db
    .query('organizer_user_directory_membership_propagations')
    .withIndex('by_organizer_and_user', (query) =>
      query.eq('organizerId', organizerId).eq('userId', userId),
    )
    .unique();
}

async function buildDirectoryEntry(
  ctx: DirectoryCtx,
  organizerId: Id<'organizers'>,
  userId: Id<'users'>,
): Promise<DirectoryEntryFields | null> {
  const [
    user,
    latestApplication,
    isDirectMember,
    isCommunityAdmin,
    hasMagicLinkAccess,
  ] = await Promise.all([
    ctx.db.get('users', userId),
    getLatestApplicationForOrganizer(
      {db: ctx.db},
      {
        organizerId,
        userId,
      },
    ),
    authz.hasRole(
      ctx,
      authzUserId(userId),
      'member',
      organizerScope(organizerId),
    ),
    authz.hasRole(
      ctx,
      authzUserId(userId),
      'community_admin',
      organizerScope(organizerId),
    ),
    hasOrganizerMagicLinkRedemption(ctx, organizerId, userId),
  ]);

  if (!user) {
    return null;
  }

  let communityAccessSource:
    | 'approved_application'
    | 'magic_link'
    | 'direct_member'
    | 'shared'
    | undefined;
  let trustedViaOrganizerName: string | undefined;

  if (latestApplication?.status === 'approved' && isDirectMember) {
    communityAccessSource = 'approved_application';
  } else if (hasMagicLinkAccess && isDirectMember) {
    communityAccessSource = 'magic_link';
  } else if (isDirectMember) {
    communityAccessSource = 'direct_member';
  } else {
    trustedViaOrganizerName = await getTrustedViaOrganizerName(
      ctx,
      organizerId,
      userId,
    );
    if (trustedViaOrganizerName) {
      communityAccessSource = 'shared';
    }
  }

  if (!communityAccessSource) {
    return null;
  }

  return {
    organizerId,
    userId,
    sortTime: Math.max(
      user._creationTime,
      latestApplication?._creationTime ?? 0,
    ),
    ...toDirectoryApplicationSnapshot(latestApplication),
    ...(isCommunityAdmin ? {isCommunityAdmin: true} : {}),
    communityAccessSource,
    ...(communityAccessSource === 'shared' && trustedViaOrganizerName
      ? {trustedViaOrganizerName}
      : {}),
  };
}

async function resolveActiveDirectoryEntry(
  ctx: DirectoryCtx,
  entry: DirectoryEntryDoc,
): Promise<DirectoryEntryFields | null> {
  if (entry.communityAccessSource !== undefined) {
    return entry;
  }

  return await buildDirectoryEntry(ctx, entry.organizerId, entry.userId);
}

function toUserApplicationRow(
  entry: DirectoryEntryFields,
  user: Doc<'users'>,
): UserApplicationRow {
  return {
    user: stripSensitiveUserFields(user),
    application:
      entry.applicationId &&
      entry.applicationCreationTime !== undefined &&
      entry.applicationStatus !== undefined &&
      entry.applicationAnswers !== undefined
        ? {
            _id: entry.applicationId,
            _creationTime: entry.applicationCreationTime,
            userId: entry.userId,
            organizerId: entry.organizerId,
            status: entry.applicationStatus,
            ...(entry.applicationProcessedBy
              ? {processedBy: entry.applicationProcessedBy}
              : {}),
            ...(entry.applicationReason
              ? {reason: entry.applicationReason}
              : {}),
            answers: entry.applicationAnswers,
          }
        : null,
    ...(entry.isCommunityAdmin ? {isCommunityAdmin: true} : {}),
    ...(entry.communityAccessSource
      ? {communityAccessSource: entry.communityAccessSource}
      : {}),
    ...(entry.trustedViaOrganizerName
      ? {trustedViaOrganizerName: entry.trustedViaOrganizerName}
      : {}),
  };
}

export async function recomputeOrganizerDirectoryRow(
  ctx: MutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    userId: Id<'users'>;
  },
): Promise<void> {
  const [existingEntry, nextEntry] = await Promise.all([
    findDirectoryEntry(ctx, args.organizerId, args.userId),
    buildDirectoryEntry(ctx, args.organizerId, args.userId),
  ]);

  if (!nextEntry) {
    if (existingEntry) {
      await ctx.db.delete('organizer_user_directory', existingEntry._id);
    }
    return;
  }

  if (existingEntry) {
    await ctx.db.replace(
      'organizer_user_directory',
      existingEntry._id,
      nextEntry,
    );
    return;
  }

  await ctx.db.insert('organizer_user_directory', nextEntry);
}

export async function refreshOrganizerDirectoryForMembershipChange(
  ctx: MutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    userId: Id<'users'>;
  },
): Promise<void> {
  await recomputeOrganizerDirectoryRow(ctx, args);
  await enqueueMembershipPropagation(ctx, args);
}

export async function refreshOrganizerDirectoryForTrustedMembers(
  ctx: MutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    trustedOrganizerId: Id<'organizers'>;
  },
): Promise<number> {
  const trustedMemberIds = await listOrganizerMembers(
    ctx,
    args.trustedOrganizerId,
  );

  for (const userId of trustedMemberIds) {
    await recomputeOrganizerDirectoryRow(ctx, {
      organizerId: args.organizerId,
      userId: userId as Id<'users'>,
    });
  }

  return trustedMemberIds.length;
}

export async function enqueueOrganizerDirectoryRebuild(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  organizerId: Id<'organizers'>,
): Promise<void> {
  const existingRebuild = await findDirectoryRebuild(ctx, organizerId);

  if (existingRebuild) {
    if (
      existingRebuild.status === 'running' &&
      !existingRebuild.restartRequested
    ) {
      await ctx.db.patch(
        'organizer_user_directory_rebuilds',
        existingRebuild._id,
        {restartRequested: true},
      );
    }
    return;
  }

  await ctx.db.insert('organizer_user_directory_rebuilds', {
    organizerId,
    status: 'queued',
  });
  await ctx.scheduler.runAfter(
    0,
    internal.communities.directory.users.runOrganizerDirectoryRebuildInternal,
    {
      organizerId,
    },
  );
}

export async function enqueueMembershipPropagation(
  ctx: Pick<MutationCtx, 'db' | 'scheduler'>,
  args: {
    organizerId: Id<'organizers'>;
    userId: Id<'users'>;
  },
): Promise<void> {
  const existingPropagation = await findMembershipPropagation(
    ctx,
    args.organizerId,
    args.userId,
  );

  if (existingPropagation) {
    if (
      existingPropagation.status === 'running' &&
      !existingPropagation.restartRequested
    ) {
      await ctx.db.patch(
        'organizer_user_directory_membership_propagations',
        existingPropagation._id,
        {restartRequested: true},
      );
    }
    return;
  }

  await ctx.db.insert('organizer_user_directory_membership_propagations', {
    organizerId: args.organizerId,
    userId: args.userId,
    status: 'queued',
  });
  await ctx.scheduler.runAfter(
    0,
    internal.communities.directory.users
      .propagateMembershipChangeToTrustingOrganizersInternal,
    args,
  );
}

export async function loadUserApplicationPageForOrganizerFromDirectory(
  ctx: DirectoryCtx,
  organizerId: Id<'organizers'>,
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  },
): Promise<UserApplicationPage> {
  const trustedOrganizers = await listDirectTrustedOrganizers(ctx, organizerId);
  assertTrustLinkLimit(trustedOrganizers.length);

  if (paginationOpts.numItems <= 0) {
    return {
      page: [],
      isDone: false,
      continueCursor: paginationOpts.cursor ?? '',
    };
  }

  const activeEntries: DirectoryEntryFields[] = [];
  let cursor = paginationOpts.cursor;
  let isDone = false;
  let continueCursor = '';

  while (activeEntries.length < paginationOpts.numItems && !isDone) {
    const remainingItems = paginationOpts.numItems - activeEntries.length;
    const result = await ctx.db
      .query('organizer_user_directory')
      .withIndex('by_organizer_and_sortTime_and_user', (query) =>
        query.eq('organizerId', organizerId),
      )
      .order('desc')
      .paginate({
        cursor,
        numItems: remainingItems,
      });

    const resolvedEntries = await Promise.all(
      result.page.map((entry) => resolveActiveDirectoryEntry(ctx, entry)),
    );
    activeEntries.push(
      ...resolvedEntries.filter(
        (entry): entry is DirectoryEntryFields => entry !== null,
      ),
    );
    isDone = result.isDone;
    continueCursor = result.continueCursor;
    cursor = result.continueCursor;
  }

  const usersById = await batchGetUsers(
    ctx,
    activeEntries.map((entry) => entry.userId),
  );

  return {
    page: activeEntries.flatMap((entry) => {
      const user = usersById.get(entry.userId);
      return user ? [toUserApplicationRow(entry, user)] : [];
    }),
    isDone,
    continueCursor,
  };
}

async function rebuildOrganizerDirectoryBatch(
  ctx: MutationCtx,
  organizerId: Id<'organizers'>,
  paginationOpts: {
    cursor: string | null;
    numItems: number;
  },
): Promise<{
  processedUsers: number;
  isDone: boolean;
  continueCursor: string;
}> {
  const result = await ctx.db.query('users').paginate(paginationOpts);

  for (const user of result.page) {
    await recomputeOrganizerDirectoryRow(ctx, {
      organizerId,
      userId: user._id,
    });
  }

  return {
    processedUsers: result.page.length,
    isDone: result.isDone,
    continueCursor: result.continueCursor,
  };
}

export async function rebuildOrganizerDirectory(
  ctx: MutationCtx,
  organizerId: Id<'organizers'>,
): Promise<number> {
  let cursor: string | null = null;
  let processedUsers = 0;

  while (true) {
    const result = await rebuildOrganizerDirectoryBatch(ctx, organizerId, {
      cursor,
      numItems: ORGANIZER_DIRECTORY_REBUILD_BATCH_SIZE,
    });
    processedUsers += result.processedUsers;
    if (result.isDone) {
      return processedUsers;
    }
    cursor = result.continueCursor;
  }
}

export async function propagateMembershipChangeToTrustingOrganizers(
  ctx: MutationCtx,
  args: {
    organizerId: Id<'organizers'>;
    userId: Id<'users'>;
    paginationOpts?: {
      cursor: string | null;
      numItems: number;
    };
  },
): Promise<{
  processedOrganizers: number;
  isDone: boolean;
  continueCursor: string;
}> {
  const propagation = await findMembershipPropagation(
    ctx,
    args.organizerId,
    args.userId,
  );
  if (!propagation && !args.paginationOpts) {
    return {
      processedOrganizers: 0,
      isDone: true,
      continueCursor: '',
    };
  }
  const paginationOpts = propagation
    ? {
        cursor: propagation.continueCursor ?? null,
        numItems: TRUSTING_ORGANIZER_PROPAGATION_BATCH_SIZE,
      }
    : (args.paginationOpts ?? {
        cursor: null,
        numItems: TRUSTING_ORGANIZER_PROPAGATION_BATCH_SIZE,
      });
  const trustingOrganizers = await paginateTrustingOrganizerIds(
    ctx,
    args.organizerId,
    paginationOpts,
  );

  if (propagation && propagation.status !== 'running') {
    await ctx.db.patch(
      'organizer_user_directory_membership_propagations',
      propagation._id,
      {status: 'running'},
    );
  }

  for (const trustLink of trustingOrganizers.page) {
    await recomputeOrganizerDirectoryRow(ctx, {
      organizerId: trustLink.trustingOrganizerId,
      userId: args.userId,
    });
  }

  if (!propagation) {
    return {
      processedOrganizers: trustingOrganizers.page.length,
      isDone: trustingOrganizers.isDone,
      continueCursor: trustingOrganizers.continueCursor,
    };
  }

  if (!trustingOrganizers.isDone) {
    await ctx.db.patch(
      'organizer_user_directory_membership_propagations',
      propagation._id,
      {
        status: 'running',
        continueCursor: trustingOrganizers.continueCursor,
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.communities.directory.users
        .propagateMembershipChangeToTrustingOrganizersInternal,
      {
        organizerId: args.organizerId,
        userId: args.userId,
      },
    );
    return {
      processedOrganizers: trustingOrganizers.page.length,
      isDone: trustingOrganizers.isDone,
      continueCursor: trustingOrganizers.continueCursor,
    };
  }

  if (propagation.restartRequested) {
    await ctx.db.patch(
      'organizer_user_directory_membership_propagations',
      propagation._id,
      {
        status: 'queued',
        continueCursor: undefined,
        restartRequested: undefined,
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.communities.directory.users
        .propagateMembershipChangeToTrustingOrganizersInternal,
      {
        organizerId: args.organizerId,
        userId: args.userId,
      },
    );
  } else {
    await ctx.db.delete(
      'organizer_user_directory_membership_propagations',
      propagation._id,
    );
  }

  return {
    processedOrganizers: trustingOrganizers.page.length,
    isDone: trustingOrganizers.isDone,
    continueCursor: trustingOrganizers.continueCursor,
  };
}

export async function runOrganizerDirectoryRebuild(
  ctx: MutationCtx,
  organizerId: Id<'organizers'>,
): Promise<{
  processedUsers: number;
  isDone: boolean;
  continueCursor: string;
  restarted: boolean;
}> {
  const rebuild = await findDirectoryRebuild(ctx, organizerId);

  if (!rebuild) {
    return {
      processedUsers: 0,
      isDone: true,
      continueCursor: '',
      restarted: false,
    };
  }

  if (rebuild.status !== 'running') {
    await ctx.db.patch('organizer_user_directory_rebuilds', rebuild._id, {
      status: 'running',
    });
  }

  const result = await rebuildOrganizerDirectoryBatch(ctx, organizerId, {
    cursor: rebuild.continueCursor ?? null,
    numItems: ORGANIZER_DIRECTORY_REBUILD_BATCH_SIZE,
  });

  if (!result.isDone) {
    await ctx.db.patch('organizer_user_directory_rebuilds', rebuild._id, {
      status: 'running',
      continueCursor: result.continueCursor,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.communities.directory.users.runOrganizerDirectoryRebuildInternal,
      {organizerId},
    );
    return {
      ...result,
      restarted: false,
    };
  }

  if (rebuild.restartRequested) {
    await ctx.db.patch('organizer_user_directory_rebuilds', rebuild._id, {
      status: 'queued',
      continueCursor: undefined,
      restartRequested: undefined,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.communities.directory.users.runOrganizerDirectoryRebuildInternal,
      {organizerId},
    );
    return {
      ...result,
      restarted: true,
    };
  }

  await ctx.db.delete('organizer_user_directory_rebuilds', rebuild._id);
  return {
    ...result,
    restarted: false,
  };
}
