import {Migrations} from '@convex-dev/migrations';
import {components, internal} from './_generated/api';
import type {DataModel} from './_generated/dataModel';
import {digestBearerToken, tokenPrefix} from './lib/token_digests';

export const migrations = new Migrations<DataModel>(components.migrations);

export const backfillMagicLinkTokenDigests = migrations.define({
  table: 'magic_links',
  migrateOne: async (_ctx, link) => {
    if (!link.token) return {};
    return {
      tokenDigest:
        link.tokenDigest ?? (await digestBearerToken('magic_link', link.token)),
      tokenPrefix: link.tokenPrefix ?? tokenPrefix(link.token),
      token: undefined,
    };
  },
});

export const backfillAdminInviteTokenDigests = migrations.define({
  table: 'admin_invites',
  migrateOne: async (_ctx, invite) => {
    if (!invite.token) return {};
    return {
      tokenDigest:
        invite.tokenDigest ??
        (await digestBearerToken('admin_invite', invite.token)),
      tokenPrefix: invite.tokenPrefix ?? tokenPrefix(invite.token),
      token: undefined,
    };
  },
});

export const backfillGuestSessionTokenDigests = migrations.define({
  table: 'guest_sessions',
  migrateOne: async (_ctx, session) => {
    if (!session.sessionToken) return {};
    return {
      sessionTokenDigest:
        session.sessionTokenDigest ??
        (await digestBearerToken('guest_session', session.sessionToken)),
      sessionTokenPrefix:
        session.sessionTokenPrefix ?? tokenPrefix(session.sessionToken),
      sessionToken: undefined,
    };
  },
});

export const backfillUserMarketingUnsubscribeTokenDigests = migrations.define({
  table: 'marketingEmailPreferences',
  migrateOne: async (_ctx, preference) => {
    if (!preference.unsubToken) return {};
    return {
      unsubTokenDigest:
        preference.unsubTokenDigest ??
        (await digestBearerToken(
          'marketing_unsubscribe_user',
          preference.unsubToken,
        )),
      unsubTokenPrefix:
        preference.unsubTokenPrefix ?? tokenPrefix(preference.unsubToken),
      unsubToken: undefined,
    };
  },
});

export const backfillAddressMarketingUnsubscribeTokenDigests =
  migrations.define({
    table: 'emailAddressMarketingPreferences',
    migrateOne: async (_ctx, preference) => {
      if (!preference.unsubToken) return {};
      return {
        unsubTokenDigest:
          preference.unsubTokenDigest ??
          (await digestBearerToken(
            'marketing_unsubscribe_address',
            preference.unsubToken,
          )),
        unsubTokenPrefix:
          preference.unsubTokenPrefix ?? tokenPrefix(preference.unsubToken),
        unsubToken: undefined,
      };
    },
  });

export const backfillMarketingDeliveryTrackingTokenDigests = migrations.define({
  table: 'marketingEmailDeliveries',
  migrateOne: async (_ctx, delivery) => {
    return {
      ...(delivery.openToken
        ? {
            openTokenDigest:
              delivery.openTokenDigest ??
              (await digestBearerToken(
                'marketing_tracking_open',
                delivery.openToken,
              )),
            openTokenPrefix:
              delivery.openTokenPrefix ?? tokenPrefix(delivery.openToken),
            openToken: undefined,
          }
        : {}),
      ...(delivery.clickToken
        ? {
            clickTokenDigest:
              delivery.clickTokenDigest ??
              (await digestBearerToken(
                'marketing_tracking_click',
                delivery.clickToken,
              )),
            clickTokenPrefix:
              delivery.clickTokenPrefix ?? tokenPrefix(delivery.clickToken),
            clickToken: undefined,
          }
        : {}),
    };
  },
});

export const clearLegacyUserEmailChangeTokens = migrations.define({
  table: 'users',
  migrateOne: (_ctx, user) => {
    if (!user.emailChangeToken && !user.emailChangeTokenExpiry) return {};
    return {
      emailChangeToken: undefined,
      emailChangeTokenExpiry: undefined,
    };
  },
});

export const runTokenDigestBackfills = migrations.runner([
  internal.migrations.backfillMagicLinkTokenDigests,
  internal.migrations.backfillAdminInviteTokenDigests,
  internal.migrations.backfillGuestSessionTokenDigests,
  internal.migrations.backfillUserMarketingUnsubscribeTokenDigests,
  internal.migrations.backfillAddressMarketingUnsubscribeTokenDigests,
  internal.migrations.backfillMarketingDeliveryTrackingTokenDigests,
  internal.migrations.clearLegacyUserEmailChangeTokens,
]);
