import {computed, effect, inject, Injectable, signal} from '@angular/core';
import {injectConvex, injectQuery} from 'convex-angular';
import type {FunctionArgs, FunctionReturnType} from 'convex/server';
import {api} from '@convex/_generated/api';
import {AuthService} from '@/core/services/auth.service';
import {logger} from '@/utils/logger';

type ListMineArgs = FunctionArgs<typeof api.guest_list.delegate.listMine>;
type ListMineResult = FunctionReturnType<
  typeof api.guest_list.delegate.listMine
>;

/** Server-capped page size for `listMine` (see `PAGE_SIZE` in the delegate service). */
const DISCOVERY_PAGE_SIZE = 50;

@Injectable({providedIn: 'root'})
export class GuestListDashboardService {
  private readonly convex = injectConvex();
  private readonly auth = inject(AuthService);
  private readonly authenticatedUserId = computed(
    () => this.auth.user()?._id ?? null,
  );
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
      const authSettled = this.auth.authSettled();
      const userId = this.authenticatedUserId();
      const generation = ++this.loadGeneration;
      if (!enabled || !authSettled || !userId) {
        this.activeAssignments.set(false);
        return;
      }
      this.activeAssignments.set(false);
      void this.loadActiveAssignments(generation);
    });
  }

  private async loadActiveAssignments(generation: number): Promise<void> {
    try {
      let cursor: ListMineArgs['paginationOpts']['cursor'] = null;
      const seenCursors = new Set<string>();

      while (generation === this.loadGeneration) {
        const result: ListMineResult = await this.convex.mutation(
          api.guest_list.delegate.listMine,
          {
            // Ask for the server-capped page size, not one row at a time: each
            // call is a mutation that re-runs a linking scan server-side, and
            // this runs on every dashboard load and auth change just to answer
            // "does this user have any active assignment?".
            paginationOpts: {numItems: DISCOVERY_PAGE_SIZE, cursor},
          } satisfies ListMineArgs,
        );
        if (generation !== this.loadGeneration) return;
        if (result.page.length > 0) {
          this.activeAssignments.set(true);
          return;
        }
        if (result.isDone) {
          this.activeAssignments.set(false);
          return;
        }

        const nextCursor: string = result.continueCursor;
        if (!nextCursor || seenCursors.has(nextCursor)) {
          logger.error(
            'Guest-list assignment discovery returned a repeated cursor',
          );
          this.activeAssignments.set(false);
          return;
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      }
    } catch (error) {
      logger.error('Failed to discover active guest-list assignments', error);
      if (generation === this.loadGeneration) {
        this.activeAssignments.set(false);
      }
    }
  }
}
