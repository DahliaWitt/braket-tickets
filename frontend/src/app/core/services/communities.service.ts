import {Injectable} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Id} from '@convex/_generated/dataModel';
import {type FunctionArgs, type FunctionReturnType} from 'convex/server';
import {isNonRetryableReadError, retryWithDelays} from '@/utils/async-control';

// Extract types directly from the generated Convex API
export type CreateCommunityArgs = FunctionArgs<
  typeof api.communities.profile.create
>;
export type UpdateCommunityArgs = FunctionArgs<
  typeof api.communities.profile.update
>;
export type Community = FunctionReturnType<
  typeof api.communities.list.list
>[number];
export type AdminCommunity = Exclude<
  FunctionReturnType<typeof api.communities.profile.getAdmin>,
  null
>;
const COMMUNITY_READ_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000] as const;

// VettingQuestion type for form handling
export interface VettingQuestion {
  id: string;
  question: string;
  type: 'text' | 'long_text' | 'boolean' | 'select' | 'checkbox';
  required: boolean;
  options?: string[];
}

/**
 * Service for managing communities.
 *
 * Provides CRUD operations for community records. Communities are the entities
 * (collectives, venues) that host events on the platform.
 * All write operations require admin authentication.
 */
@Injectable({
  providedIn: 'root',
})
export class CommunitiesService {
  private convex = injectConvex();

  /**
   * Retrieves all communities.
   *
   * Returns the complete list of communities registered on the platform,
   * including their vetting questions and configuration.
   *
   * @returns Array of all community records.
   */
  list(): Promise<Community[]> {
    return this.convex.query(api.communities.list.list, {});
  }

  /**
   * Fetches a single community by ID.
   *
   * @param id - The ID of the community to retrieve.
   * @returns The community record, or null if not found.
   */
  get(id: Id<'organizers'>): Promise<Community | null> {
    return this.convex.query(api.communities.public.get, {id});
  }

  /**
   * Fetches a single community by ID (admin view).
   *
   * Returns the full record including Stripe Connect state. Requires the caller
   * to have manage permission on the community.
   */
  getAdmin(id: Id<'organizers'>): Promise<AdminCommunity | null> {
    return this.convex.query(api.communities.profile.getAdmin, {id});
  }

  /**
   * Fetches a community by slug or Convex ID.
   *
   * Tries slug lookup first; falls back to treating the input as a Convex ID.
   * Use this for vetting page navigation where the URL may contain either form.
   *
   * @param slugOrId - A community slug or Convex document ID.
   * @returns The community record, or null if not found.
   */
  getBySlugOrId(slugOrId: string): Promise<Community | null> {
    return retryWithDelays({
      delaysMs: COMMUNITY_READ_RETRY_DELAYS_MS,
      run: () =>
        this.convex.query(api.communities.public.getBySlugOrId, {slugOrId}),
      shouldRetry: (error, attemptIndex) => {
        if (isNonRetryableReadError(error)) return false;
        return attemptIndex < COMMUNITY_READ_RETRY_DELAYS_MS.length - 1;
      },
    });
  }

  /**
   * Creates a new community.
   *
   * Registers a new community on the platform with their name, description,
   * and optional vetting configuration.
   *
   * @param community - The community data including name, description, and vetting questions.
   * @returns The ID of the newly created community.
   *
   * @remarks
   * Admin-only operation.
   */
  create(community: CreateCommunityArgs): Promise<Id<'organizers'>> {
    return this.convex.mutation(api.communities.profile.create, community);
  }

  /**
   * Updates an existing community.
   *
   * Modifies community fields such as name, description, or vetting questions.
   * Only provided fields are updated; omitted fields remain unchanged.
   *
   * @param args - Update arguments including community ID and any fields to update.
   * @param args.id - Required ID of the community to update.
   *
   * @remarks
   * Admin-only operation.
   */
  async update(args: UpdateCommunityArgs): Promise<void> {
    await this.convex.mutation(api.communities.profile.update, args);
  }

  /**
   * Deletes a community.
   *
   * Permanently removes a community from the platform. This operation may
   * fail if the community has associated events.
   *
   * @param id - The ID of the community to delete.
   *
   * @remarks
   * Admin-only operation.
   * Consider archiving instead of deleting if historical data preservation is needed.
   */
  async remove(id: Id<'organizers'>): Promise<void> {
    await this.convex.mutation(api.communities.profile.remove, {id});
  }
}
