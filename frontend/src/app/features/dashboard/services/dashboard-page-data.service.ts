import {computed, inject, Injectable, resource} from '@angular/core';
import {PublicCommunitiesService} from '@/core/services/public-communities.service';
import {safeResourceValue} from '@/utils/resource';
import {api} from '@convex/_generated/api';
import {injectQueries} from 'convex-angular';
import type {FunctionReturnType} from 'convex/server';

export type DashboardApproval = FunctionReturnType<
  typeof api.communities.trust_links.getUserApprovals
>[number];
export type DashboardApplication = FunctionReturnType<
  typeof api.communities.applications.getMyApplications
>[number];

@Injectable()
export class DashboardPageDataService {
  private readonly publicCommunitiesService = inject(PublicCommunitiesService);

  // Community approvals + all user applications — one realtime multi-query
  // subscription for dashboard status links and pending/rejected state.
  private readonly relationshipQueries = injectQueries(() => ({
    approvals: {
      query: api.communities.trust_links.getUserApprovals,
      args: {},
    },
    myApplications: {
      query: api.communities.applications.getMyApplications,
      args: {},
    },
  }));

  readonly approvals = computed<DashboardApproval[]>(
    () => this.relationshipQueries.results().approvals ?? [],
  );
  readonly approvalsLoading = computed(
    () => this.relationshipQueries.statuses().approvals === 'pending',
  );

  readonly myApplications = computed<DashboardApplication[]>(
    () => this.relationshipQueries.results().myApplications ?? [],
  );
  readonly myApplicationsLoading = computed(
    () => this.relationshipQueries.statuses().myApplications === 'pending',
  );

  private readonly publicCommunitiesResource = resource({
    params: () => ({}),
    loader: async () => this.publicCommunitiesService.listDirectory(),
  });
  readonly publicCommunities = computed(
    () => safeResourceValue(this.publicCommunitiesResource) ?? [],
  );
  readonly publicCommunitiesLoading = this.publicCommunitiesResource.isLoading;
}
