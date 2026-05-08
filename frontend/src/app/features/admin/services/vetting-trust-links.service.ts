import {Injectable, inject} from '@angular/core';
import {injectConvex} from 'convex-angular';
import {AnalyticsService} from '@/core/services/analytics.service';
import {api} from '@convex/_generated/api';
import {type FunctionReturnType} from 'convex/server';

/** Type for a trust link row (enriched with org names + member count for outgoing rows). */
export type TrustLink = FunctionReturnType<
  typeof api.communities.trust_links.list
>[number];

/**
 * Service for managing vetting trust links between organizers.
 *
 * Trust links allow one organizer to recognize another organizer's vetted users,
 * enabling cross-community ticket purchases without re-vetting.
 * All write operations require admin authentication.
 */
@Injectable({
  providedIn: 'root',
})
export class VettingTrustLinksService {
  private convex = injectConvex();
  private analytics = inject(AnalyticsService);

  /**
   * Creates a new trust link from one organizer to another.
   *
   * @param trustingOrganizerId - The organizer granting trust
   * @param trustedOrganizerId - The organizer whose list is trusted
   */
  async create(
    trustingOrganizerId: TrustLink['trustingOrganizerId'],
    trustedOrganizerId: TrustLink['trustedOrganizerId'],
  ): Promise<void> {
    await this.convex.mutation(api.communities.trust_links.create, {
      trustingOrganizerId,
      trustedOrganizerId,
    });
    this.analytics.capture('trust_link_created', {
      trustingOrganizerId,
      trustedOrganizerId,
    });
  }

  /**
   * Removes a trust link permanently.
   */
  async remove(
    trustingOrganizerId: TrustLink['trustingOrganizerId'],
    trustedOrganizerId: TrustLink['trustedOrganizerId'],
  ): Promise<void> {
    await this.convex.mutation(api.communities.trust_links.remove, {
      trustingOrganizerId,
      trustedOrganizerId,
    });
    this.analytics.capture('trust_link_removed', {
      trustingOrganizerId,
      trustedOrganizerId,
    });
  }
}
