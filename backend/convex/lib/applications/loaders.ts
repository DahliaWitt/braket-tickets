import type {Doc, Id} from '../../_generated/dataModel';
import type {DatabaseReader} from '../../_generated/server';

type QueryDb = Pick<DatabaseReader, 'query'>;
type ApplicationStatus = Doc<'applications'>['status'];

export function applicationsByOrganizerQuery(
  db: QueryDb,
  organizerId: Id<'organizers'>,
) {
  return db
    .query('applications')
    .withIndex('by_organizer_status', (query) =>
      query.eq('organizerId', organizerId),
    );
}

export function applicationsByOrganizerStatusQuery(
  db: QueryDb,
  organizerId: Id<'organizers'>,
  status: ApplicationStatus,
) {
  return db
    .query('applications')
    .withIndex('by_organizer_status', (query) =>
      query.eq('organizerId', organizerId).eq('status', status),
    );
}

export function applicationsByUserQuery(db: QueryDb, userId: Id<'users'>) {
  return db
    .query('applications')
    .withIndex('by_user_status', (query) => query.eq('userId', userId));
}

export function applicationsByUserStatusQuery(
  db: QueryDb,
  userId: Id<'users'>,
  status: ApplicationStatus,
) {
  return db
    .query('applications')
    .withIndex('by_user_status', (query) =>
      query.eq('userId', userId).eq('status', status),
    );
}

export function applicationsByUserAndOrganizerQuery(
  db: QueryDb,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
) {
  return db
    .query('applications')
    .withIndex('by_user_and_organizer', (query) =>
      query.eq('userId', userId).eq('organizerId', organizerId),
    );
}

export function applicationsByUserAndOrganizerStatusQuery(
  db: QueryDb,
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
  status: ApplicationStatus,
) {
  return db
    .query('applications')
    .withIndex('by_user_and_organizer_and_status', (query) =>
      query
        .eq('userId', userId)
        .eq('organizerId', organizerId)
        .eq('status', status),
    );
}
