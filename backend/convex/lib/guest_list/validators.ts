import {paginationResultValidator} from 'convex/server';
import {v} from 'convex/values';

export const guestListRoleValidator = v.union(
  v.literal('artist'),
  v.literal('staff'),
);

export const guestListAssignmentStatusValidator = v.union(
  v.literal('active'),
  v.literal('revoked'),
);

export const guestListInviteStateValidator = v.union(
  v.literal('pending'),
  v.literal('accepted'),
  v.literal('failed'),
);

export const guestListDeliveryStateValidator = v.union(
  v.literal('not_sent'),
  v.literal('queued'),
  v.literal('sent'),
  v.literal('failed'),
);

export const guestListDelegateAccessValidator = v.union(
  v.object({kind: v.literal('signedIn'), assignmentId: v.id('guestListAssignments')}),
  v.object({kind: v.literal('token'), token: v.string()}),
);

export const guestListAssignmentViewValidator = v.object({
  assignmentId: v.id('guestListAssignments'),
  eventId: v.id('events'),
  role: guestListRoleValidator,
  displayName: v.string(),
  email: v.string(),
  grantedSlots: v.number(),
  usedSlots: v.number(),
  status: guestListAssignmentStatusValidator,
  inviteState: guestListInviteStateValidator,
  admissionGuestId: v.optional(v.id('guests')),
  createdAt: v.number(),
  lastInviteAcceptedAt: v.optional(v.number()),
  revokedAt: v.optional(v.number()),
});

export const guestListAssignmentPageValidator = paginationResultValidator(
  guestListAssignmentViewValidator,
);

export const sourcedGuestViewValidator = v.object({
  guestId: v.id('guests'),
  name: v.string(),
  email: v.string(),
  emailedAt: v.optional(v.number()),
  deliveryState: guestListDeliveryStateValidator,
});

export const sourcedGuestPageValidator = paginationResultValidator(
  sourcedGuestViewValidator,
);

export const guestListEventOverviewValidator = v.object({
  selfServiceGuestCount: v.number(),
  activeGrantedSlots: v.number(),
  activeArtistGuestCount: v.number(),
  activeStaffGuestCount: v.number(),
  activeAssignmentCount: v.number(),
  totalGuestAdmissionCount: v.number(),
});

export const guestListMineItemValidator = v.object({
  assignmentId: v.id('guestListAssignments'),
  eventId: v.id('events'),
  eventTitle: v.string(),
  eventDate: v.string(),
  eventEndDate: v.optional(v.string()),
  role: guestListRoleValidator,
  grantedSlots: v.number(),
  usedSlots: v.number(),
});

export const guestListMinePageValidator = paginationResultValidator(
  guestListMineItemValidator,
);

export const guestListDelegateViewValidator = v.union(
  v.object({status: v.literal('unavailable')}),
  v.object({
    status: v.literal('available'),
    assignment: guestListAssignmentViewValidator,
    event: v.object({
      title: v.string(),
      date: v.string(),
      endDate: v.optional(v.string()),
      location: v.optional(v.string()),
    }),
    guests: sourcedGuestPageValidator,
  }),
);

export const guestListAuditActorKindValidator = v.union(
  v.literal('organizer'),
  v.literal('signed_in_delegate'),
  v.literal('token_delegate'),
  v.literal('system'),
);

export const guestListAuditActionValidator = v.union(
  v.literal('assignment.create'),
  v.literal('assignment.grant_change'),
  v.literal('assignment.invite'),
  v.literal('assignment.resend'),
  v.literal('assignment.revoke'),
  v.literal('assignment.user_link'),
  v.literal('guest.add'),
  v.literal('guest.edit'),
  v.literal('guest.remove'),
);
