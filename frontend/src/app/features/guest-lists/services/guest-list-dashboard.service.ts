import {effect, Injectable, signal} from '@angular/core';
import {injectConvex, injectQuery} from 'convex-angular';
import type {FunctionArgs} from 'convex/server';
import {api} from '@convex/_generated/api';
import {logger} from '@/utils/logger';

type ListMineArgs = FunctionArgs<typeof api.guest_list.delegate.listMine>;

@Injectable({providedIn: 'root'})
export class GuestListDashboardService {
  private readonly convex = injectConvex();
  private readonly featureStateQuery = injectQuery(
    api.guest_list.feature_state.get,
    () => ({}),
  );
  private readonly activeAssignments = signal(false);
  private loadGeneration = 0;

  readonly hasActiveAssignments = this.activeAssignments.asReadonly();

  constructor() {
    effect(() => {
      const enabled = this.featureStateQuery.data()?.enabled === true;
      const generation = ++this.loadGeneration;
      if (!enabled) {
        this.activeAssignments.set(false);
        return;
      }
      void this.loadActiveAssignments(generation);
    });
  }

  private async loadActiveAssignments(generation: number): Promise<void> {
    try {
      const result = await this.convex.mutation(
        api.guest_list.delegate.listMine,
        {
          paginationOpts: {numItems: 1, cursor: null},
        } satisfies ListMineArgs,
      );
      if (generation === this.loadGeneration) {
        this.activeAssignments.set(result.page.length > 0);
      }
    } catch (error) {
      logger.error('Failed to discover active guest-list assignments', error);
      if (generation === this.loadGeneration) {
        this.activeAssignments.set(false);
      }
    }
  }
}
