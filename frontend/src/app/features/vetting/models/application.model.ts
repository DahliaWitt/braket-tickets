import { type Doc } from '@convex/_generated/dataModel';

// Application type based on Convex document
export type Application = Doc<'applications'> & {
  // Enriched fields populated by list queries
  user?: Doc<'users'>;
  processor?: Doc<'users'>;
  organizer?: Doc<'organizers'> | null;
};
