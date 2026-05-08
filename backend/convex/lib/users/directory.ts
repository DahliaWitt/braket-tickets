import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {getCommunityMembers} from '../../lib/authz';
import {getLatestApplicationForOrganizer} from '../applications/read_models';
import {stripCommunityAdminFields, stripSensitiveUserFields} from './helpers';

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
  return members
    .map(stripSensitiveUserFields)
    .map(stripCommunityAdminFields);
}

async function searchUsersByNameOrEmail(
  db: UsersDirectoryDb,
  query: string,
) {
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

async function searchApprovedOrganizerMembersByNameOrEmail(
  db: UsersDirectoryDb,
  organizerId: OrganizerId,
  query: string,
) {
  const lowerQuery = query.toLowerCase();
  const matches: Doc<'users'>[] = [];
  const seen = new Set<Doc<'users'>['_id']>();

  const pushApprovedMatches = async (users: AsyncIterable<Doc<'users'>>) => {
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
    await pushApprovedMatches(
      db
        .query('users')
        .withIndex('email', (emailQuery) =>
          emailQuery.gte('email', lowerQuery).lt('email', lowerQuery + '\uffff'),
        ),
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

  const matches =
    args.organizerId ?
      await searchApprovedOrganizerMembersByNameOrEmail(
        db,
        args.organizerId,
        query,
      ) :
      await searchUsersByNameOrEmail(db, query);

  return matches.map(stripSensitiveUserFields);
}
