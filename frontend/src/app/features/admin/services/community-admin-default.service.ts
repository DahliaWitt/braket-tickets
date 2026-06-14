import {computed, inject, Injectable} from '@angular/core';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {AuthService} from '@/core/services/auth.service';
import {injectConvex} from 'convex-angular';
import type {FunctionArgs} from 'convex/server';

type SetDefaultCommunityAdminOrganizerArgs = FunctionArgs<
  typeof api.users.profile.setDefaultCommunityAdminOrganizer
>;

@Injectable({
  providedIn: 'root',
})
export class CommunityAdminDefaultService {
  private readonly auth = inject(AuthService);
  private readonly convex = injectConvex();

  readonly defaultCommunityId = computed<Id<'organizers'> | null>(
    () => this.auth.user()?.defaultCommunityAdminOrganizerId ?? null,
  );

  isDefaultCommunity(communityId: Id<'organizers'> | null): boolean {
    return communityId !== null && this.defaultCommunityId() === communityId;
  }

  async setDefaultCommunity(
    organizerId: SetDefaultCommunityAdminOrganizerArgs['organizerId'],
  ): Promise<void> {
    await this.convex.mutation(
      api.users.profile.setDefaultCommunityAdminOrganizer,
      {organizerId},
    );
  }
}
