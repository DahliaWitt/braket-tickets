import {computed, inject, Injectable, resource} from '@angular/core';
import {PublicCommunitiesService} from '@/core/services/public-communities.service';
import {safeResourceValue} from '@/utils/resource';
import {api} from '@convex/_generated/api';
import {injectQuery} from 'convex-angular';
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

  // Community approvals — realtime subscription for dashboard status links.
  private readonly approvalsQuery = injectQuery(
    api.communities.trust_links.getUserApprovals,
    () => ({}),
  );
  readonly approvals = computed<DashboardApproval[]>(
    () => this.approvalsQuery.data() ?? [],
  );
  readonly approvalsLoading = this.approvalsQuery.isLoading;

  // All user applications — realtime subscription for pending/rejected status.
  private readonly myApplicationsQuery = injectQuery(
    api.communities.applications.getMyApplications,
    () => ({}),
  );
  readonly myApplications = computed<DashboardApplication[]>(
    () => this.myApplicationsQuery.data() ?? [],
  );
  readonly myApplicationsLoading = this.myApplicationsQuery.isLoading;

  private readonly publicCommunitiesResource = resource({
    params: () => ({}),
    loader: async () => this.publicCommunitiesService.listDirectory(),
  });
  readonly publicCommunities = computed(
    () => safeResourceValue(this.publicCommunitiesResource) ?? [],
  );
  readonly publicCommunitiesLoading = this.publicCommunitiesResource.isLoading;
}
