import type {Doc, Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {batchGetDocuments, batchGetUsers} from '../../lib/batch_utils';
import {
  applicationsByOrganizerStatusQuery,
  applicationsByUserAndOrganizerQuery,
} from './loaders';
import {
  batchGetStorageUrls,
  type StorageUrlContext,
} from '../../lib/storage_urls';
import {stripSensitiveUserFields} from '../users/helpers';

type ApplicationDoc = Doc<'applications'>;
type OrganizerDoc = Doc<'organizers'>;
type UserDoc = Doc<'users'>;
type ApplicationStatus = ApplicationDoc['status'];

type ApplicationsQueryDbContext = {
  db: Pick<QueryCtx['db'], 'query'>;
};

type ApplicationsDbContext = {
  db: QueryCtx['db'];
};

type ApplicationsReadContext = ApplicationsDbContext & StorageUrlContext;

export function pickLatestApplicationByCreationTime(
  applications: ReadonlyArray<ApplicationDoc>,
): ApplicationDoc | null {
  if (applications.length === 0) return null;
  return [...applications].sort((a, b) => b._creationTime - a._creationTime)[0] ?? null;
}

export async function getLatestApplicationForOrganizer(
  ctx: ApplicationsQueryDbContext,
  args: {
    userId: Id<'users'>;
    organizerId: Id<'organizers'>;
  },
): Promise<ApplicationDoc | null> {
  return await applicationsByUserAndOrganizerQuery(
    ctx.db,
    args.userId,
    args.organizerId,
  )
    .order('desc')
    .first();
}

export async function mapApplicationsWithOrganizers(
  ctx: ApplicationsReadContext,
  applications: ReadonlyArray<ApplicationDoc>,
) {
  const organizerIds = new Set(
    applications
      .map((application) => application.organizerId)
      .filter((organizerId): organizerId is Id<'organizers'> => organizerId !== undefined),
  );
  const organizerMap = await batchGetDocuments(ctx, 'organizers', organizerIds);
  const organizers = [...organizerMap.values()];
  const logoUrlMap = await batchGetStorageUrls(
    ctx,
    organizers.map((organizer) => organizer.logoStorageId ?? null),
  );

  return applications.map((application) => {
    const organizer = application.organizerId
      ? organizerMap.get(application.organizerId)
      : undefined;
    const logoUrl = organizer?.logoStorageId
      ? (logoUrlMap.get(organizer.logoStorageId) ?? null)
      : undefined;

    return {
      _id: application._id,
      _creationTime: application._creationTime,
      organizerId: application.organizerId,
      organizerName: organizer?.name ?? 'Unknown Community',
      organizerLogoUrl: logoUrl ?? undefined,
      status: application.status,
      denyReason: application.denyReason,
      reason: application.reason,
    };
  });
}

export function toApplicationListRow(
  application: ApplicationDoc,
  args: {
    user: UserDoc | null | undefined;
    processor: UserDoc | null | undefined;
    organizer: OrganizerDoc | null | undefined;
  },
) {
  return {
    ...application,
    user: args.user ? stripSensitiveUserFields(args.user) : null,
    processor: args.processor ? stripSensitiveUserFields(args.processor) : null,
    organizer: args.organizer
      ? {
          _id: args.organizer._id,
          _creationTime: args.organizer._creationTime,
          name: args.organizer.name,
          email: args.organizer.email,
          contactInfo: args.organizer.contactInfo,
          vettingQuestions: args.organizer.vettingQuestions,
        }
      : null,
  };
}

export async function buildApplicationListRows(
  ctx: ApplicationsDbContext,
  applications: ReadonlyArray<ApplicationDoc>,
) {
  const userIds = new Set<Id<'users'>>();
  const organizerIds = new Set<Id<'organizers'>>();

  for (const application of applications) {
    userIds.add(application.userId);
    if (application.processedBy) {
      userIds.add(application.processedBy);
    }
    if (application.organizerId) {
      organizerIds.add(application.organizerId);
    }
  }

  const [userMap, organizerMap] = await Promise.all([
    batchGetUsers(ctx, userIds),
    batchGetDocuments(ctx, 'organizers', organizerIds),
  ]);

  return applications.map((application) =>
    toApplicationListRow(application, {
      user: userMap.get(application.userId),
      processor: application.processedBy
        ? userMap.get(application.processedBy)
        : undefined,
      organizer: application.organizerId
        ? organizerMap.get(application.organizerId)
        : undefined,
    }),
  );
}

export async function listApplicationsForOrganizer(
  ctx: ApplicationsDbContext,
  args: {
    organizerId: Id<'organizers'>;
    status?: ApplicationStatus;
  },
) {
  if (args.status) {
    return applicationsByOrganizerStatusQuery(
      ctx.db,
      args.organizerId,
      args.status,
    ).take(500);
  }

  return ctx.db
    .query('applications')
    .withIndex('by_organizer_status', (query) =>
      query.eq('organizerId', args.organizerId),
    )
    .take(500);
}

export async function listApplicationsAcrossOrganizers(
  ctx: ApplicationsDbContext,
  args: {
    organizerIds: ReadonlyArray<Id<'organizers'>>;
    status?: ApplicationStatus;
  },
) {
  const applicationsByOrganizer = await Promise.all(
    args.organizerIds.map((organizerId) =>
      listApplicationsForOrganizer(ctx, {
        organizerId,
        status: args.status,
      }),
    ),
  );

  return applicationsByOrganizer.flat();
}
