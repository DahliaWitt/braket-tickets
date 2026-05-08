import {v, ConvexError} from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import {throwAppError, throwInvalidInput} from '../lib/errors';
import type {Id} from '../_generated/dataModel';
import {internal} from '../_generated/api';
import {getAuthUser, getAuthUserId, requireUser} from '../lib/auth_identity';
import {
  loadEventOrThrow,
  requireEditEvent,
  requireEventForEdit,
  requireManageCommunity,
} from '../lib/access';
import {
  getUserCommunities,
  isCommunityAdmin,
  listPublishedTrustedAudienceOrganizers,
} from '../lib/authz';
import {
  audienceScopeValidator,
  marketingEmailStatusValidator,
} from '../lib/validators/marketing';
import {
  readMarketingDeliveryStatsFromRecord,
  recordMarketingDeliveryClick,
  recordMarketingDeliveryOpen,
  summarizeMarketingDeliveryStats,
} from '../lib/marketing_emails/tracking';
import {
  getAnnouncementRecipients as getAudienceRecipients,
  getDistinctRecipientEmailCount,
  isMarketingAudienceOverHardCap,
  MARKETING_AUDIENCE_TOO_LARGE_CODE,
  MAX_MARKETING_AUDIENCE_USERS,
  type MarketingAnnouncementRecipient,
} from '../lib/marketing_emails/audience';
import {
  getUserMarketingPreferences,
  reEnableAllMarketingPreferencesForUser,
  unsubscribeAllMarketingPreferencesForUser,
  upsertMarketingPreference,
} from '../lib/marketing_emails/preferences';
import {
  getAddressMarketingPreferencesByToken,
  unsubscribeAllAddressMarketingPreferencesForEmail,
  updateAddressMarketingPreferenceInTokenScope,
  updateAddressMarketingPreferenceByToken,
  findAddressMarketingPreferenceByToken,
} from '../lib/marketing_emails/address_preferences';
import {
  getPreferencesByToken as getMarketingPreferencesByToken,
  updateMarketingPreferenceInTokenScope,
  updateMarketingPreferenceByToken,
  findMarketingPreferenceByToken,
} from '../lib/marketing_emails/tokens';
import {
  assertMarketingAnnouncementScheduleWindow,
  cancelScheduledAnnouncement,
  replaceScheduledAnnouncement,
  sendScheduledAnnouncement,
  sendScheduledAnnouncementBatch,
} from '../lib/marketing_emails/announcements';

export const getRecipientCount = query({
  args: {
    eventId: v.optional(v.id('events')),
    organizerId: v.optional(v.id('organizers')),
    audienceScope: v.optional(audienceScopeValidator),
  },
  returns: v.object({
    count: v.number(),
    cappedAt500: v.boolean(),
    directCount: v.number(),
    trustLinkedCount: v.number(),
    totalCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const {_id: actorId} = await requireUser(ctx);
    if (!!args.eventId === !!args.organizerId) {
      throwInvalidInput('Provide exactly one of eventId or organizerId.');
    }

    let organizerId: Id<'organizers'>;
    if (args.eventId !== undefined) {
      const event = await loadEventOrThrow(ctx, args.eventId);
      await requireEditEvent(ctx, actorId, event);
      organizerId = event.organizerId;
    } else {
      organizerId = args.organizerId!;
      await requireManageCommunity(ctx, actorId, organizerId);
    }

    const scope = args.audienceScope ?? 'community';
    let recipients: MarketingAnnouncementRecipient[];
    try {
      recipients = await getAudienceRecipients(ctx, organizerId, scope);
    } catch (e) {
      // Surface AUDIENCE_TOO_LARGE through the preview contract rather than
      // bubbling a transaction error. The frontend gates Schedule/Queue on
      // `cappedAt500`, so a silent throw here would leave the buttons
      // enabled and the organizer would only discover the cap at send time
      // (for scheduled announcements, hours later). Any other error is
      // re-thrown so real failures are not masked.
      if (
        e instanceof ConvexError &&
        typeof e.data === 'object' &&
        e.data !== null &&
        (e.data as {code?: string}).code === MARKETING_AUDIENCE_TOO_LARGE_CODE
      ) {
        return {
          count: MAX_MARKETING_AUDIENCE_USERS,
          cappedAt500: true,
          directCount: 0,
          trustLinkedCount: 0,
          totalCount: MAX_MARKETING_AUDIENCE_USERS,
        };
      }
      throw e;
    }
    const directCount = recipients.filter(
      (recipient) => recipient.vettedViaOrganizerIds === undefined,
    ).length;
    const trustLinkedCount = recipients.filter(
      (recipient) => recipient.vettedViaOrganizerIds !== undefined,
    ).length;
    const count = getDistinctRecipientEmailCount(recipients);

    // Legacy field name: the frontend treats `cappedAt500` as a hard block.
    // Exact-limit audiences are still legal; only over-limit direct audiences
    // reach this branch and need to be blocked. Trust-linked over-limit cases
    // throw above and are mapped into the preview contract.
    const cappedAt500 = isMarketingAudienceOverHardCap(
      directCount + trustLinkedCount,
    );

    return {
      count,
      cappedAt500,
      directCount,
      trustLinkedCount,
      totalCount: count,
    };
  },
});

export const scheduleAnnouncement = mutation({
  args: {
    eventId: v.id('events'),
    scheduledFor: v.number(),
    audienceScope: v.optional(audienceScopeValidator),
  },
  returns: v.id('eventMarketingEmails'),
  handler: async (ctx, args) => {
    const {user, event} = await requireEventForEdit(ctx, args.eventId);
    const callerId = user._id;

    assertMarketingAnnouncementScheduleWindow(args.scheduledFor, Date.now());

    let audienceScope = args.audienceScope;
    if (audienceScope === 'community_and_trusted') {
      const publishedTrustLinks = await listPublishedTrustedAudienceOrganizers(
        ctx,
        event.organizerId,
      );
      if (publishedTrustLinks.length === 0) {
        audienceScope = 'community';
      }
    }

    return replaceScheduledAnnouncement({
      adminId: callerId,
      ctx: {
        db: ctx.db,
        runMutation: ctx.runMutation,
        scheduler: ctx.scheduler,
      },
      eventId: args.eventId,
      scheduledFor: args.scheduledFor,
      audienceScope,
    });
  },
});

export const cancelAnnouncement = mutation({
  args: {
    eventMarketingEmailId: v.id('eventMarketingEmails'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const record = await ctx.db.get(
      'eventMarketingEmails',
      args.eventMarketingEmailId,
    );
    if (!record) throwAppError('RECORD_NOT_FOUND', 'record_not_found');

    const {user} = await requireEventForEdit(ctx, record.eventId);
    const callerId = user._id;

    if (record.status !== 'scheduled') {
      throwAppError('NOT_SCHEDULED', 'not_scheduled');
    }

    await cancelScheduledAnnouncement({
      adminId: callerId,
      ctx: {
        db: ctx.db,
        runMutation: ctx.runMutation,
        scheduler: ctx.scheduler,
      },
      record,
    });
    return null;
  },
});

export const sendAnnouncement = internalMutation({
  args: {
    eventMarketingEmailId: v.id('eventMarketingEmails'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await sendScheduledAnnouncement(ctx, args.eventMarketingEmailId);
    return null;
  },
});

export const sendAnnouncementBatch = internalMutation({
  args: {
    eventMarketingEmailId: v.id('eventMarketingEmails'),
    eventId: v.id('events'),
    organizerId: v.id('organizers'),
    recipients: v.array(
      v.object({
        userId: v.id('users'),
        email: v.string(),
        marketingPreference: v.optional(
          v.object({
            _id: v.id('marketingEmailPreferences'),
            userId: v.id('users'),
            organizerId: v.id('organizers'),
          }),
        ),
        vettedViaOrganizerIds: v.optional(v.array(v.id('organizers'))),
        globalMarketingOptOut: v.optional(v.boolean()),
      }),
    ),
    sentAt: v.number(),
    batchIndex: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await sendScheduledAnnouncementBatch(ctx, args);
    return null;
  },
});

export const updateMarketingPreference = mutation({
  args: {
    organizerId: v.id('organizers'),
    optedIn: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const {_id: userId} = await requireUser(ctx);

    if (
      !args.optedIn &&
      (await isCommunityAdmin(ctx, userId, args.organizerId))
    ) {
      throwAppError(
        'ADMIN_CANNOT_OPT_OUT',
        'Community admins cannot opt out of their own community marketing emails.',
      );
    }

    await upsertMarketingPreference(ctx.db, {
      organizerId: args.organizerId,
      optedIn: args.optedIn,
      userId,
    });
    return null;
  },
});

export const unsubscribeAll = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const {_id: userId} = await requireUser(ctx);

    const adminOrganizerIds = await getUserCommunities(ctx, userId);
    await unsubscribeAllMarketingPreferencesForUser(ctx.db, {
      userId,
      adminOrganizerIds,
    });
    await ctx.db.patch('users', userId, {globalMarketingOptOut: true});
    return null;
  },
});

export const unsubscribeAllForUser = internalMutation({
  args: {
    userId: v.id('users'),
    adminOrganizerIds: v.optional(v.array(v.id('organizers'))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await unsubscribeAllMarketingPreferencesForUser(ctx.db, {
      userId: args.userId,
      adminOrganizerIds: args.adminOrganizerIds,
    });
    await ctx.db.patch('users', args.userId, {globalMarketingOptOut: true});
    return null;
  },
});

export const clearGlobalMarketingOptOut = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const {_id: userId} = await requireUser(ctx);
    await ctx.db.patch('users', userId, {globalMarketingOptOut: false});
    return null;
  },
});

export const reEnableAll = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const updatedAt = Date.now();

    await reEnableAllMarketingPreferencesForUser(ctx.db, {
      userId: user._id,
      updatedAt,
    });
    if (user.globalMarketingOptOut === true) {
      await ctx.db.patch('users', user._id, {globalMarketingOptOut: false});
    }
    return null;
  },
});

export const getGlobalOptOutStatus = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const user = await getAuthUser(ctx);
    return !!user?.globalMarketingOptOut;
  },
});

export const getUserPreferences = query({
  args: {},
  returns: v.array(
    v.object({
      organizerId: v.id('organizers'),
      organizerName: v.string(),
      organizerLogoStorageId: v.optional(v.union(v.id('_storage'), v.null())),
      optedIn: v.boolean(),
      isAdmin: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const adminOrganizerIds = await getUserCommunities(ctx, userId);
    return getUserMarketingPreferences(ctx.db, userId, {adminOrganizerIds});
  },
});

export const unsubscribeByToken = internalMutation({
  args: {token: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    const userPreference = await findMarketingPreferenceByToken(
      ctx.db,
      args.token,
    );
    if (userPreference) {
      await assertTokenScopedMarketingOptOutAllowed(
        ctx,
        userPreference.userId,
        userPreference.organizerId,
        false,
      );
      await updateMarketingPreferenceByToken(ctx.db, {
        token: args.token,
        optedIn: false,
      });
      return null;
    }

    await updateAddressMarketingPreferenceByToken(ctx.db, {
      token: args.token,
      optedIn: false,
    });
    return null;
  },
});

async function assertTokenScopedMarketingOptOutAllowed(
  ctx: Parameters<typeof isCommunityAdmin>[0],
  userId: Id<'users'>,
  organizerId: Id<'organizers'>,
  optedIn: boolean,
): Promise<void> {
  if (optedIn) return;
  if (!(await isCommunityAdmin(ctx, userId, organizerId))) return;

  throwAppError(
    'ADMIN_CANNOT_OPT_OUT',
    'Community admins cannot opt out of their own community marketing emails.',
  );
}

export const getPreferencesByToken = internalQuery({
  args: {token: v.string()},
  returns: v.union(
    v.object({
      unsubscribedFrom: v.union(
        v.object({
          organizerName: v.string(),
          organizerId: v.id('organizers'),
        }),
        v.null(),
      ),
      globalMarketingOptOut: v.boolean(),
      preferences: v.array(
        v.object({
          organizerName: v.string(),
          organizerId: v.id('organizers'),
          optedIn: v.boolean(),
          isAdmin: v.boolean(),
        }),
      ),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userPreferences = await getMarketingPreferencesByToken(
      ctx.db,
      args.token,
      {getAdminOrganizerIds: (userId) => getUserCommunities(ctx, userId)},
    );
    if (userPreferences) {
      return userPreferences;
    }

    return getAddressMarketingPreferencesByToken(ctx.db, args.token);
  },
});

export const toggleByToken = internalMutation({
  args: {
    token: v.string(),
    optedIn: v.boolean(),
    organizerId: v.optional(v.id('organizers')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.organizerId) {
      const userPreference = await findMarketingPreferenceByToken(
        ctx.db,
        args.token,
      );
      if (userPreference) {
        await assertTokenScopedMarketingOptOutAllowed(
          ctx,
          userPreference.userId,
          args.organizerId,
          args.optedIn,
        );
        await updateMarketingPreferenceInTokenScope(ctx.db, {
          token: args.token,
          organizerId: args.organizerId,
          optedIn: args.optedIn,
        });
        return null;
      }

      await updateAddressMarketingPreferenceInTokenScope(ctx.db, {
        token: args.token,
        organizerId: args.organizerId,
        optedIn: args.optedIn,
      });
      return null;
    }

    const userPreference = await findMarketingPreferenceByToken(
      ctx.db,
      args.token,
    );
    if (userPreference) {
      await assertTokenScopedMarketingOptOutAllowed(
        ctx,
        userPreference.userId,
        userPreference.organizerId,
        args.optedIn,
      );
      await updateMarketingPreferenceByToken(ctx.db, {
        token: args.token,
        optedIn: args.optedIn,
      });
      return null;
    }

    await updateAddressMarketingPreferenceByToken(ctx.db, {
      token: args.token,
      optedIn: args.optedIn,
    });
    return null;
  },
});

export const unsubscribeAllByToken = internalMutation({
  args: {token: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    const userPreference = await findMarketingPreferenceByToken(
      ctx.db,
      args.token,
    );
    if (userPreference) {
      const adminOrganizerIds = await getUserCommunities(
        ctx,
        userPreference.userId,
      );
      await ctx.runMutation(internal.marketing.emails.unsubscribeAllForUser, {
        userId: userPreference.userId,
        adminOrganizerIds,
      });
      return null;
    }

    const addressPreference = await findAddressMarketingPreferenceByToken(
      ctx.db,
      args.token,
    );
    if (!addressPreference) {
      throwAppError('INVALID_TOKEN', 'invalid_token');
    }

    await unsubscribeAllAddressMarketingPreferencesForEmail(ctx.db, {
      email: addressPreference.email,
    });
    return null;
  },
});

export const recordDeliveryOpen = internalMutation({
  args: {token: v.string()},
  returns: v.boolean(),
  handler: async (ctx, args) =>
    recordMarketingDeliveryOpen(ctx.db, {
      token: args.token,
    }),
});

export const recordDeliveryClick = internalMutation({
  args: {token: v.string()},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) =>
    recordMarketingDeliveryClick(ctx.db, {
      token: args.token,
    }),
});

export const getAnnouncementStatus = query({
  args: {eventId: v.id('events')},
  returns: v.union(
    v.object({
      _id: v.id('eventMarketingEmails'),
      status: marketingEmailStatusValidator,
      scheduledFor: v.number(),
      recipientCount: v.optional(v.number()),
      sentAt: v.optional(v.number()),
      uniqueOpenCount: v.number(),
      totalOpenCount: v.number(),
      uniqueClickCount: v.number(),
      totalClickCount: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const statusEvent = await ctx.db.get('events', args.eventId);
    if (!statusEvent) return null;
    const {_id: userId} = await requireUser(ctx);
    await requireEditEvent(ctx, userId, statusEvent);

    const latest = await ctx.db
      .query('eventMarketingEmails')
      .withIndex('by_event', (query) => query.eq('eventId', args.eventId))
      .order('desc')
      .first();

    if (!latest) return null;

    const stats =
      readMarketingDeliveryStatsFromRecord(latest) ??
      (await summarizeMarketingDeliveryStats(ctx.db, latest._id));
    return {
      _id: latest._id,
      status: latest.status,
      scheduledFor: latest.scheduledFor,
      recipientCount: latest.recipientCount,
      sentAt: latest.sentAt,
      uniqueOpenCount: stats.uniqueOpenCount,
      totalOpenCount: stats.totalOpenCount,
      uniqueClickCount: stats.uniqueClickCount,
      totalClickCount: stats.totalClickCount,
    };
  },
});
