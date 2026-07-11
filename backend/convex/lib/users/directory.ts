import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {getCommunityMembers} from '../../lib/authz';
import {applicationsByOrganizerStatusQuery} from '../applications/loaders';
import {getLatestApplicationForOrganizer} from '../applications/read_models';
import {
  filterMembersByEmailPrefix,
  stripCommunityAdminFields,
  stripSensitiveUserFields,
} from './helpers';

type UsersDirectoryCtx = QueryCtx | MutationCtx;
type UsersDirectoryDb = QueryCtx['db'] | MutationCtx['db'];
type OrganizerId = Id<'organizers'>;

export async function listUsersForRootAdmin(ctx: UsersDirectoryCtx) {
  const users = await ctx.db.query('users').order('desc').take(1000);
  return users.map(stripSensitiveUserFields);
}

export async function listUsersForCommunityAdmin(
  ctx: UsersDirectoryCtx,
  organizerId: OrganizerId,
) {
  const members = await getCommunityMembers(ctx, organizerId);
  return members.map(stripSensitiveUserFields).map(stripCommunityAdminFields);
}

async function searchUsersByNameOrEmail(db: UsersDirectoryDb, query: string) {
  const lowerQuery = query.toLowerCase();
  const nameResults = await db
    .query('users')
    .withSearchIndex('search_name_email', (q) => q.search('name', query))
    .take(50);

  const emailResults = await db
    .query('users')
    .withIndex('email', (q) =>
      q.gte('email', lowerQuery).lt('email', lowerQuery + '\uffff'),
    )
    .take(50);

  const seen = new Set(nameResults.map((user) => user._id));
  const emailMatches = emailResults.filter(
    (user) =>
      !seen.has(user._id) && user.email?.toLowerCase().includes(lowerQuery),
  );

  return [...nameResults, ...emailMatches].slice(0, 50);
}

async function filterUsersByApprovedOrganizerMembership(
  db: UsersDirectoryDb,
  organizerId: OrganizerId,
  users: ReadonlyArray<Doc<'users'>>,
) {
  const latestApplications = await Promise.all(
    users.map((user) =>
      getLatestApplicationForOrganizer(
        {db},
        {
          userId: user._id,
          organizerId,
        },
      ),
    ),
  );

  return users.filter(
    (_, index) => latestApplications[index]?.status === 'approved',
  );
}

/**
 * Enumerates the distinct users who currently hold at least one `approved`
 * application for the organizer, using the `by_organizer_status` index. This is
 * the organizer's approved-membership set, bounded by community size — the
 * search scopes the email branch to it so recall never depends on the global
 * `users` table. Callers must still confirm the member's *latest* application is
 * approved (an older approved row may be superseded by a newer decision).
 */
async function listApprovedOrganizerMemberIds(
  db: UsersDirectoryDb,
  organizerId: OrganizerId,
): Promise<Id<'users'>[]> {
  const memberIds = new Set<Id<'users'>>();
  for await (const application of applicationsByOrganizerStatusQuery(
    db,
    organizerId,
    'approved',
  )) {
    memberIds.add(application.userId);
  }
  return [...memberIds];
}

async function searchApprovedOrganizerMembersByNameOrEmail(
  db: UsersDirectoryDb,
  organizerId: OrganizerId,
  query: string,
) {
  const lowerQuery = query.toLowerCase();
  const matches: Doc<'users'>[] = [];
  const seen = new Set<Doc<'users'>['_id']>();

  const pushApprovedMatches = async (
    users: AsyncIterable<Doc<'users'>> | Iterable<Doc<'users'>>,
  ) => {
    for await (const user of users) {
      if (seen.has(user._id)) {
        continue;
      }
      seen.add(user._id);

      const [approvedUser] = await filterUsersByApprovedOrganizerMembership(
        db,
        organizerId,
        [user],
      );
      if (!approvedUser) {
        continue;
      }

      matches.push(approvedUser);
      if (matches.length >= 50) {
        break;
      }
    }
  };

  await pushApprovedMatches(
    db
      .query('users')
      .withSearchIndex('search_name_email', (search) =>
        search.search('name', query),
      ),
  );

  if (matches.length < 50) {
    // Email branch: match the prefix WITHIN the organizer's approved membership
    // instead of scanning the global `users` email index and then
    // scope-filtering. Enumerating approved members first keeps reads bounded
    // by community size and, unlike a capped global scan, can never drop an
    // in-scope member just because unrelated platform users share the prefix
    // and sort ahead of them. `pushApprovedMatches` still re-checks each
    // candidate against the *latest* application, so an older approved row
    // cannot surface a member whose current status is no longer approved.
    const approvedMemberIds = await listApprovedOrganizerMemberIds(
      db,
      organizerId,
    );
    await pushApprovedMatches(
      await filterMembersByEmailPrefix(db, approvedMemberIds, lowerQuery),
    );
  }

  return matches.slice(0, 50);
}

export async function searchUsersForAdminScope(
  db: UsersDirectoryDb,
  args: {
    query: string;
    organizerId: OrganizerId | null;
  },
) {
  const query = args.query.trim();
  if (!query) return [];

  const matches = args.organizerId
    ? await searchApprovedOrganizerMembersByNameOrEmail(
        db,
        args.organizerId,
        query,
      )
    : await searchUsersByNameOrEmail(db, query);

  return matches.map(stripSensitiveUserFields);
}
