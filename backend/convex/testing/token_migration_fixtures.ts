import {v} from 'convex/values';
import {testingMutation} from './wrappers';

const legacyTokenFixtureResultValidator = v.object({
  adminInviteId: v.id('admin_invites'),
  magicLinkId: v.id('magic_links'),
  guestSessionId: v.id('guest_sessions'),
  userPreferenceId: v.id('marketingEmailPreferences'),
  addressPreferenceId: v.id('emailAddressMarketingPreferences'),
  marketingDeliveryId: v.id('marketingEmailDeliveries'),
  tokens: v.object({
    adminInvite: v.string(),
    magicLink: v.string(),
    guestSession: v.string(),
    userUnsubscribe: v.string(),
    addressUnsubscribe: v.string(),
    trackingOpen: v.string(),
    trackingClick: v.string(),
    emailChange: v.string(),
  }),
});

/**
 * Seeds intentionally legacy plaintext bearer-token rows for migration tests.
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedLegacyTokenRows = testingMutation({
  args: {
    userId: v.id('users'),
    organizerId: v.id('organizers'),
    eventId: v.id('events'),
    email: v.string(),
  },
  returns: legacyTokenFixtureResultValidator,
  handler: async ({db}, args) => {
    const now = Date.now();
    const tokens = {
      adminInvite: 'legacy-admin-invite-token',
      magicLink: 'legacy-magic-link-token',
      guestSession: 'legacy-guest-session-token',
      userUnsubscribe: 'legacy-user-unsubscribe-token',
      addressUnsubscribe: 'legacy-address-unsubscribe-token',
      trackingOpen: 'legacy-open-token',
      trackingClick: 'legacy-click-token',
      emailChange: 'legacy-email-change-token',
    };

    /* eslint-disable no-raw-db-mutations/no-raw-db-mutation -- Migration tests need intentionally pre-hardening plaintext rows. */
    const adminInviteId = await db.insert('admin_invites', {
      email: args.email,
      organizerId: args.organizerId,
      communityName: 'Legacy Invite Community',
      token: tokens.adminInvite,
      invitedBy: args.userId,
      status: 'pending',
      expiresAt: now + 7 * 24 * 60 * 60 * 1000,
    });

    const magicLinkId = await db.insert('magic_links', {
      token: tokens.magicLink,
      createdBy: args.userId,
      organizerId: args.organizerId,
      status: 'active',
      label: 'Legacy magic link',
    });

    const guestSessionId = await db.insert('guest_sessions', {
      email: args.email.toLowerCase(),
      sessionToken: tokens.guestSession,
      expiresAt: now + 24 * 60 * 60 * 1000,
      lastActiveAt: now,
    });

    const userPreferenceId = await db.insert('marketingEmailPreferences', {
      userId: args.userId,
      organizerId: args.organizerId,
      optedIn: true,
      unsubToken: tokens.userUnsubscribe,
      updatedAt: now,
    });

    const addressPreferenceId = await db.insert(
      'emailAddressMarketingPreferences',
      {
        email: args.email.toLowerCase(),
        organizerId: args.organizerId,
        optedIn: true,
        unsubToken: tokens.addressUnsubscribe,
        updatedAt: now,
      },
    );

    const eventMarketingEmailId = await db.insert('eventMarketingEmails', {
      eventId: args.eventId,
      adminId: args.userId,
      scheduledFor: now,
      status: 'sent',
      recipientCount: 1,
      sentAt: now,
    });

    const marketingDeliveryId = await db.insert('marketingEmailDeliveries', {
      eventMarketingEmailId,
      eventId: args.eventId,
      organizerId: args.organizerId,
      userId: args.userId,
      recipient: args.email.toLowerCase(),
      targetUrl: 'https://example.com/legacy-target',
      openToken: tokens.trackingOpen,
      clickToken: tokens.trackingClick,
      sentAt: now,
      openCount: 0,
      clickCount: 0,
    });

    await db.patch('users', args.userId, {
      pendingEmail: 'updated-legacy@example.com',
      emailChangeToken: tokens.emailChange,
      emailChangeTokenExpiry: now + 60 * 60 * 1000,
    });
    /* eslint-enable no-raw-db-mutations/no-raw-db-mutation */

    return {
      adminInviteId,
      magicLinkId,
      guestSessionId,
      userPreferenceId,
      addressPreferenceId,
      marketingDeliveryId,
      tokens,
    };
  },
});
