import {Injectable} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {type Application} from '../models/application.model';
import {type Id} from '@convex/_generated/dataModel';
import {type FunctionArgs, type FunctionReturnType} from 'convex/server';

/**
 * Service for managing vetting applications.
 * Handles submission, review, approval, rejection, and revocation of applications.
 *
 * @remarks
 * Applications are used to vet users before allowing ticket purchases for
 * certain events. Admins can review, approve, reject, or revoke applications.
 */
@Injectable({
  providedIn: 'root',
})
export class ApplicationsService {
  private convex = injectConvex();

  /**
   * Maps a Convex application document to the frontend Application model.
   * Passes through enriched fields (user, processor, organizer) directly.
   *
   * @param doc - Raw document from Convex
   * @returns The mapped Application or null if invalid
   */
  private mapToApp(doc: unknown): Application | null {
    if (!this.isValidApplicationDocument(doc)) return null;

    return {
      ...doc,
      user: doc.user,
      processor: doc.processor,
      organizer: doc.organizer,
    };
  }

  private isValidApplicationDocument(doc: unknown): doc is Application {
    return (
      typeof doc === 'object' &&
      doc !== null &&
      '_id' in doc &&
      'userId' in doc &&
      'status' in doc
    );
  }

  mapApplications(docs: unknown): Application[] {
    if (!Array.isArray(docs)) return [];
    return docs
      .map((doc) => this.mapToApp(doc))
      .filter((app): app is Application => app !== null);
  }

  mapHistoryApplications(docs: unknown): Application[] {
    return this.mapApplications(docs)
      .filter((app) => app.status !== 'pending')
      .toSorted((a, b) => b._creationTime - a._creationTime);
  }

  /**
   * Fetches the current user's application, if one exists.
   *
   * @returns The user's application or null if they haven't applied
   */
  async getMyApplication(): Promise<Application | null> {
    const app = await this.convex.query(
      api.communities.applications['getMyApplication'],
      {},
    );
    return this.mapToApp(app);
  }

  /**
   * Fetches the current user's application for a specific community.
   *
   * @param organizerId - The organizer/community to check for an existing application
   * @returns The user's application for this organizer, or null if they haven't applied
   */
  async getMyApplicationForOrganizer(
    organizerId: Id<'organizers'>,
  ): Promise<Application | null> {
    const app = await this.convex.query(
      api.communities.applications['getMyApplicationForOrganizer'],
      {
        organizerId,
      },
    );
    return this.mapToApp(app);
  }

  /**
   * Fetches all pending applications awaiting review.
   * Requires admin authentication.
   *
   * @returns Array of pending applications
   */
  async getPending(): Promise<Application[]> {
    const apps = await this.convex.query(api.communities.applications['list'], {
      status: 'pending',
    });
    return this.mapApplications(apps);
  }

  /**
   * Fetches application history (approved, rejected, revoked).
   * Excludes pending applications. Requires admin authentication.
   *
   * @returns Array of processed applications
   */
  async getHistory(): Promise<Application[]> {
    const apps = await this.convex.query(
      api.communities.applications['list'],
      {},
    );
    return this.mapHistoryApplications(apps);
  }

  /**
   * Submits a new vetting application for the current user.
   *
   * @param args - Application submission data including answers to vetting questions
   * @returns The created application in pending status
   */
  async create(
    args: FunctionArgs<typeof api.communities.applications.submit>,
  ): Promise<Application> {
    const newId = await this.convex.mutation(
      api.communities.applications.submit,
      args,
    );
    const result: Application = {
      _id: newId,
      _creationTime: Date.now(),
      userId: '' as Id<'users'>,
      status: 'pending',
      answers: args.answers,
    };
    return result;
  }

  /**
   * Approves a pending application, granting organizer-scoped access.
   * Requires admin authentication.
   *
   * @param applicationId - ID of the application to approve
   * @param _userId - Unused, kept for legacy compatibility
   * @param _processorId - Unused, kept for legacy compatibility
   * @returns The approved application
   */
  async approve(
    applicationId: Id<'applications'>,
    _userId: Id<'users'>,
    _processorId: Id<'users'>,
  ): Promise<Application> {
    await this.convex.mutation(api.communities.applications.review, {
      applicationId,
      status: 'approved',
    });
    return {_id: applicationId, status: 'approved'} as Application;
  }

  /**
   * Rejects a pending application.
   * Requires admin authentication.
   *
   * @param applicationId - ID of the application to reject
   * @param _processorId - Unused, kept for legacy compatibility
   * @param denyReason - Optional reason shown to the applicant
   * @returns The rejected application
   */
  async reject(
    applicationId: Id<'applications'>,
    _processorId: Id<'users'>,
    denyReason?: string,
  ): Promise<Application> {
    await this.convex.mutation(api.communities.applications.review, {
      applicationId,
      status: 'rejected',
      ...(denyReason ? {denyReason} : {}),
    });
    return {_id: applicationId, status: 'rejected'} as Application;
  }

  /**
   * Revokes a previously approved application.
   * Removes organizer-scoped access by revoking the application. Requires admin authentication.
   *
   * @param applicationId - ID of the application to revoke
   * @param _processorId - Unused, kept for legacy compatibility
   * @param reason - Optional reason shown to the member
   * @returns The revoked application
   */
  async revoke(
    applicationId: Id<'applications'>,
    _processorId: Id<'users'>,
    reason?: string,
  ): Promise<Application> {
    await this.convex.mutation(api.communities.applications.revoke, {
      applicationId,
      ...(reason ? {reason} : {}),
    });
    return {_id: applicationId, status: 'revoked'} as Application;
  }

  async reinstate(
    applicationId: Id<'applications'>,
    force?: boolean,
  ): Promise<
    FunctionReturnType<typeof api.communities.applications.reinstate>
  > {
    return await this.convex.mutation(api.communities.applications.reinstate, {
      applicationId,
      ...(force ? {force} : {}),
    });
  }
}
