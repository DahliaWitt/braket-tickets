import {Injectable} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {type FunctionReturnType} from 'convex/server';

type MembersPage = FunctionReturnType<
  typeof api.users.profile.listWithApplications
>;
export type MemberWithApplication = MembersPage['page'][number];

/**
 * Service for managing community membership state.
 *
 * Provides admin-only mutation wrappers for revoking membership.
 * Community admin role management lives in community-admin-settings.actions.ts.
 * Read queries (listing, searching, pagination) are handled directly via
 * convex-angular's query helpers in the components that need them.
 */
@Injectable({
  providedIn: 'root',
})
export class MembersService {
  private convex = injectConvex();

  /**
   * Revokes community membership from a user.
   *
   * Removes organizer-scoped access, preventing the user from purchasing
   * tickets for that community until they regain access.
   *
   * @param userId - The ID of the user whose membership should be revoked.
   * @param organizerId - Organizer ID to scope the revocation to a community.
   *
   * @remarks
   * Admin-only endpoint.
   *
   * Side effects:
   * - Writes a community-scoped revocation record
   * - User will need to reapply or be re-invited to regain access
   */
  async revokeMembership(userId: string, organizerId: string): Promise<void> {
    await this.convex.mutation(api.users.profile.revokeMembership, {
      userId: userId as Id<'users'>,
      organizerId: organizerId as Id<'organizers'>,
    });
  }
}
