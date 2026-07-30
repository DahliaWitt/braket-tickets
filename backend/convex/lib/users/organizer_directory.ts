import type {Doc, Id} from '../../_generated/dataModel';
import {internal} from '../../_generated/api';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {getLatestApplicationForOrganizer} from '../applications/read_models';
import {filterMembersByEmailPrefix, stripSensitiveUserFields} from './helpers';
import {
  isCommunityAdmin,
  isCommunityMember,
  listDirectTrustedOrganizers,
  listOrganizerMembers,
  paginateTrustingOrganizerIds,
} from '../../lib/authz';
import {batchGetUsers} from '../../lib/batch_utils';
import {collectAllQueryUnsafe} from '../../lib/query_scan';
import {assertTrustLinkLimit} from '../../lib/trust_links';
import {stream} from 'convex-helpers/server/stream';
import schema from '../../schema';

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
    'approved_application' | 'magic_link' | 'direct_member' | 'shared';
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
    const isTrustedMember = await isCommunityMember(
      ctx,
      userId,
      trustedOrganizer._id,
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
    userIsCommunityAdmin,
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
    isCommunityMember(ctx, userId, organizerId),
    isCommunityAdmin(ctx, userId, organizerId),
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
    ...(userIsCommunityAdmin ? {isCommunityAdmin: true} : {}),
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

/**
 * Enumerates the user IDs in the organizer's admin-directory projection using
 * the `by_organizer_and_user` index. This is the organizer's scoped membership
 * roster (bounded by community size); directory search matches the email prefix
 * within it so recall never depends on scanning the global `users` table.
 */
async function listOrganizerDirectoryMemberIds(
  ctx: DirectoryCtx,
  organizerId: Id<'organizers'>,
): Promise<Id<'users'>[]> {
  const userIds: Id<'users'>[] = [];
  for await (const entry of ctx.db
    .query('organizer_user_directory')
    .withIndex('by_organizer_and_user', (query) =>
      query.eq('organizerId', organizerId),
    )) {
    userIds.push(entry.userId);
  }
  return userIds;
}

/**
 * Searches the organizer directory by user name or email. The name branch
 * streams the `search_name_email` search index on the users table and filters
 * against the organizer directory, so the result cap applies to *scoped*
 * members, not pre-scope global users. The email branch matches the prefix
 * within the organizer's directory membership (see the email branch below).
 *
 * Returns a single non-paginated page (`isDone: true`) capped at 50 scoped results.
 */
export async function searchUserApplicationsInDirectory(
  ctx: DirectoryCtx,
  organizerId: Id<'organizers'>,
  searchTerm: string,
  options?: {scopedLimit?: number},
): Promise<UserApplicationPage> {
  const lowerTerm = searchTerm.toLowerCase();
  const scopedLimit = options?.scopedLimit ?? 50;
  const entries: DirectoryEntryFields[] = [];
  const usersById = new Map<Id<'users'>, Doc<'users'>>();
  const seen = new Set<Id<'users'>>();

  /** Check one user against the organizer directory; returns true if added. */
  async function tryAddUser(user: Doc<'users'>): Promise<boolean> {
    if (seen.has(user._id)) return false;
    seen.add(user._id);

    const entry = await ctx.db
      .query('organizer_user_directory')
      .withIndex('by_organizer_and_user', (q) =>
        q.eq('organizerId', organizerId).eq('userId', user._id),
      )
      .unique();
    if (!entry) return false;

    const resolved = await resolveActiveDirectoryEntry(ctx, entry);
    if (!resolved) return false;

    entries.push(resolved);
    usersById.set(user._id, user);
    return true;
  }

  // Stream name matches from search index (up to Convex 1024 scan limit).
  // Scope-filter as we go so out-of-community users don't consume the cap.
  for await (const user of ctx.db
    .query('users')
    .withSearchIndex('search_name_email', (q) =>
      q.search('name', searchTerm),
    )) {
    if (entries.length >= scopedLimit) break;
    await tryAddUser(user);
  }

  // Email branch: match the prefix WITHIN the organizer's directory membership
  // instead of scanning the global `users` email index and then scope-filtering.
  // The directory *is* the scoped roster, so enumerating it keeps reads bounded
  // by community size and can never drop an in-scope member just because
  // unrelated platform users share the prefix and sort ahead of them (a capped
  // global scan would leave such a member beyond its window).
  if (entries.length < scopedLimit) {
    const directoryMemberIds = await listOrganizerDirectoryMemberIds(
      ctx,
      organizerId,
    );
    const emailMatches = await filterMembersByEmailPrefix(
      ctx.db,
      directoryMemberIds,
      lowerTerm,
    );
    for (const user of emailMatches) {
      if (entries.length >= scopedLimit) break;
      await tryAddUser(user);
    }
  }

  const page = entries
    .flatMap((entry) => {
      const user = usersById.get(entry.userId);
      return user ? [toUserApplicationRow(entry, user)] : [];
    })
    .slice(0, scopedLimit);

  return {
    page,
    isDone: true,
    continueCursor: '',
  };
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

  // Convex's native `.paginate()` is limited to one call per function
  // execution, so we cannot loop over directory pages to skip inactive rows.
  // A convex-helpers stream reads across as many rows as needed in a single
  // pass, keeping only entries that still resolve as active.
  const activeDirectoryStream = () =>
    stream(ctx.db, schema)
      .query('organizer_user_directory')
      .withIndex('by_organizer_and_sortTime_and_user', (query) =>
        query.eq('organizerId', organizerId),
      )
      .order('desc')
      .filterWith(
        async (entry) =>
          (await resolveActiveDirectoryEntry(ctx, entry)) !== null,
      );

  const result = await activeDirectoryStream().paginate({
    cursor: paginationOpts.cursor,
    numItems: paginationOpts.numItems,
  });

  const activeEntries = (
    await Promise.all(
      result.page.map((entry) => resolveActiveDirectoryEntry(ctx, entry)),
    )
  ).filter((entry): entry is DirectoryEntryFields => entry !== null);

  const continueCursor = result.continueCursor;

  // The stream reports `isDone: false` whenever it fills the page exactly, even
  // when the underlying index is exhausted. Peek one active entry past the page
  // to restore the native "no more results" signal instead of forcing callers
  // into an extra empty fetch.
  let isDone = result.isDone;
  if (!isDone) {
    const nextActive = await activeDirectoryStream().paginate({
      cursor: continueCursor,
      numItems: 1,
    });
    isDone = nextActive.page.length === 0;
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
