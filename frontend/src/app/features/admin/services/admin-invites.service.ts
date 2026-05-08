import { Injectable } from '@angular/core';
import { injectConvex } from 'convex-angular';
import { api } from '@convex/_generated/api';
import { type Id } from '@convex/_generated/dataModel';

@Injectable({ providedIn: 'root' })
export class AdminInvitesService {
  private convex = injectConvex();

  createWithCommunity(
    email: string,
    communityName: string,
  ): Promise<{ inviteId: Id<'admin_invites'>; organizerId: Id<'organizers'>; inviteUrl: string }> {
    return this.convex.mutation(api.root_admin.invites.createWithCommunity, {
      email,
      communityName,
    });
  }

  redeem(token: string): Promise<{ organizerId: Id<'organizers'> }> {
    return this.convex.mutation(api.communities.management.invites.redeem, { token });
  }

  cancel(inviteId: Id<'admin_invites'>): Promise<null> {
    return this.convex.mutation(api.root_admin.invites.cancel, { inviteId });
  }
}
