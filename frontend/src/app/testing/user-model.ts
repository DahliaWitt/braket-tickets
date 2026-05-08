import type {Doc, Id} from '@convex/_generated/dataModel';

export type UserModel = Doc<'users'> & {
  communityAdminOrganizerIds?: Id<'organizers'>[];
  isRootAdmin?: boolean;
};
