import type {MutationCtx} from '../../_generated/server';
import {internal} from '../../_generated/api';
import {
  authComponent,
  buildFrontendCallbackUrl,
  createAuth,
  getSocialSignupCompletionRequired,
} from '../../lib/better_auth';
import type {AdminAuditAction} from '../../lib/admin_audit_actions';
import {
  findConflictingEmailOwner,
  lookupUserByNormalizedEmail,
  requireUser,
} from '../../lib/auth_identity';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {throwAppError, throwUnauthenticated} from '../../lib/errors';
import {
  mapEmailChangeError,
  mapLinkAccountError,
  mapSetPasswordError,
  mapUnlinkAccountError,
} from './auth_error_map';
import {rateLimiter} from '../../lib/rate_limits';
import {
  MAX_CALLBACK_URL_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  normalizeEmail,
  validateStringLength,
} from '../../lib/validation';

type SocialProvider = 'google' | 'discord';
type SocialSyncBlockedReason =
  | 'provider_email_missing'
  | 'provider_email_unverified';

function buildSocialLinkCallbackUrl(
  provider: SocialProvider,
  requestedCallbackUrl?: string,
): string {
  const callbackUrl = new URL(
    buildFrontendCallbackUrl(requestedCallbackUrl, '/confirm/social-link'),
  );
  callbackUrl.searchParams.set('provider', provider);
  return callbackUrl.toString();
}

async function insertAuthAuditLog(
  ctx: Parameters<typeof insertAdminAuditLog>[0],
  userId: Parameters<typeof insertAdminAuditLog>[1]['adminId'],
  action: AdminAuditAction,
  source: string,
  reason?: string,
): Promise<void> {
  await insertAdminAuditLog(ctx, {
    adminId: userId,
    action,
    source,
    ...(reason ? {reason} : {}),
  });
}

/**
 * Applies a Better Auth error mapper (code-first, message-fallback; see
 * `./auth_error_map`) to an unknown thrown error and throws the resulting
 * AppError — replacing the repeated
 * `catch (err) → err instanceof Error ? … : String(err) → throwAppError(…)`
 * boilerplate across auth handlers.
 */
function mapAndThrowAuthError(
  code: string,
  mapper: (error: unknown) => string,
  error: unknown,
): never {
  throwAppError(code, mapper(error));
}

export async function syncCurrentUserHandler(ctx: MutationCtx): Promise<{
  status: 'synced' | 'blocked';
  reason?: SocialSyncBlockedReason;
  requiresSocialSignupCompletion?: boolean;
}> {
  // Rate limiting not applied here because callback-driven auth completion can run
  // before the Convex identity is fully established. Using the provider email as key
  // would allow attackers to exhaust another user's bucket. Better Auth's own
  // session throttling provides upstream protection.
  const betterAuthUser = await authComponent.safeGetAuthUser(ctx);
  if (!betterAuthUser?._id) {
    throwUnauthenticated();
  }

  const blockedReason: SocialSyncBlockedReason | null = !betterAuthUser.email
    ? 'provider_email_missing'
    : betterAuthUser.emailVerified !== true
      ? 'provider_email_unverified'
      : null;

  if (blockedReason) {
    const normalizedEmail = betterAuthUser.email
      ? normalizeEmail(betterAuthUser.email)
      : null;

    if (normalizedEmail) {
      const {user: appUser} = await lookupUserByNormalizedEmail(
        ctx,
        normalizedEmail,
      );
      if (appUser) {
        await insertAuthAuditLog(
          {db: ctx.db},
          appUser._id,
          'auth.social_signin.blocked',
          'social_callback',
          blockedReason,
        );
      }
    }

    return {
      status: 'blocked',
      reason: blockedReason,
    };
  }

  const syncResult = await ctx.runMutation(internal.auth.sync.syncUser, {
    betterAuthUserId: betterAuthUser._id,
    email: normalizeEmail(betterAuthUser.email),
    name: betterAuthUser.name ?? undefined,
    image: betterAuthUser.image ?? undefined,
    authEmailVerified: true,
    socialSignupCompletionRequired: await getSocialSignupCompletionRequired(
      ctx,
      betterAuthUser._id,
    ),
  });

  return {
    status: 'synced',
    requiresSocialSignupCompletion: syncResult.requiresSocialSignupCompletion,
  };
}

export async function completeSocialSignupOnboardingHandler(
  ctx: MutationCtx,
): Promise<null> {
  const {
    _id: userId,
    socialSignupCompletionRequired,
    termsAcceptedAt,
  } = await requireUser(ctx);
  await rateLimiter.limit(ctx, 'completeSocialSignupOnboarding', {
    key: userId,
    throws: true,
  });

  if (!termsAcceptedAt) {
    await ctx.db.patch('users', userId, {
      termsAcceptedAt: Date.now(),
      socialSignupCompletionRequired: false,
    });
    await insertAuthAuditLog(
      {db: ctx.db},
      userId,
      'auth.social_signup.completed',
      'social_signup_completion',
    );
  } else if (socialSignupCompletionRequired) {
    await ctx.db.patch('users', userId, {
      socialSignupCompletionRequired: false,
    });
  }

  return null;
}

export async function changePasswordHandler(
  ctx: MutationCtx,
  args: {
    currentPassword: string;
    newPassword: string;
    revokeOtherSessions?: boolean;
  },
): Promise<null> {
  validateStringLength(
    args.currentPassword,
    'Current password',
    MAX_PASSWORD_LENGTH,
  );
  validateStringLength(args.newPassword, 'New password', MAX_PASSWORD_LENGTH);

  const {_id: userId} = await requireUser(ctx);
  await rateLimiter.limit(ctx, 'changePassword', {key: userId, throws: true});

  const {auth, headers} = await authComponent.getAuth(createAuth, ctx);
  const result = await auth.api.changePassword({
    body: {
      currentPassword: args.currentPassword,
      newPassword: args.newPassword,
      revokeOtherSessions: args.revokeOtherSessions ?? true,
    },
    headers,
  });

  if (!result) {
    throwAppError('AUTH_PASSWORD_CHANGE_FAILED', 'Failed to change password');
  }
  return null;
}

export async function linkSocialAccountHandler(
  ctx: MutationCtx,
  args: {
    provider: SocialProvider;
    callbackURL?: string;
  },
): Promise<{url: string}> {
  const appUser = await requireUser(ctx);
  const userId = appUser._id;
  await rateLimiter.limit(ctx, 'linkSocialAccount', {
    key: userId,
    throws: true,
  });
  if (args.callbackURL) {
    validateStringLength(
      args.callbackURL,
      'Callback URL',
      MAX_CALLBACK_URL_LENGTH,
    );
  }

  try {
    const {auth, headers} = await authComponent.getAuth(createAuth, ctx);
    const callbackURL = buildSocialLinkCallbackUrl(
      args.provider,
      args.callbackURL,
    );
    const result = await auth.api.linkSocialAccount({
      body: {
        provider: args.provider,
        callbackURL,
        errorCallbackURL: callbackURL,
      },
      headers,
    });

    if (!result?.url) {
      throw new Error('Provider link URL was not returned');
    }

    return {url: result.url};
  } catch (err: unknown) {
    mapAndThrowAuthError('AUTH_LINK_ACCOUNT_FAILED', mapLinkAccountError, err);
  }
}

export async function unlinkSocialAccountHandler(
  ctx: MutationCtx,
  args: {
    provider: SocialProvider;
    accountId?: string;
  },
): Promise<null> {
  const {_id: userId} = await requireUser(ctx);
  await rateLimiter.limit(ctx, 'unlinkAccount', {key: userId, throws: true});

  try {
    const {auth, headers} = await authComponent.getAuth(createAuth, ctx);
    await auth.api.unlinkAccount({
      body: {
        providerId: args.provider,
        ...(args.accountId ? {accountId: args.accountId} : {}),
      },
      headers,
    });

    await insertAuthAuditLog(
      {db: ctx.db},
      userId,
      'account.provider.unlinked',
      'account_settings',
      args.provider,
    );

    return null;
  } catch (err: unknown) {
    mapAndThrowAuthError(
      'AUTH_UNLINK_ACCOUNT_FAILED',
      mapUnlinkAccountError,
      err,
    );
  }
}

export async function setPasswordHandler(
  ctx: MutationCtx,
  args: {
    newPassword: string;
  },
): Promise<null> {
  validateStringLength(args.newPassword, 'New password', MAX_PASSWORD_LENGTH);

  const {_id: userId, socialSignupCompletionRequired} = await requireUser(ctx);
  await rateLimiter.limit(ctx, 'setPassword', {key: userId, throws: true});

  // Adding a credential account fires the Better Auth account.onCreate
  // trigger, whose sync treats "credential account exists" as onboarding
  // complete. Refuse until completeSocialSignupOnboarding has stamped terms
  // acceptance, so a direct API call cannot skip the terms gate.
  if (socialSignupCompletionRequired === true) {
    throwAppError(
      'AUTH_SET_PASSWORD_FAILED',
      'Finish signing up before adding a password.',
    );
  }

  try {
    const {auth, headers} = await authComponent.getAuth(createAuth, ctx);
    const result = await auth.api.setPassword({
      body: {
        newPassword: args.newPassword,
      },
      headers,
    });

    if (!result) {
      throw new Error('Failed to set password');
    }

    await insertAuthAuditLog(
      {db: ctx.db},
      userId,
      'account.password.created',
      'account_settings',
    );

    return null;
  } catch (err: unknown) {
    mapAndThrowAuthError('AUTH_SET_PASSWORD_FAILED', mapSetPasswordError, err);
  }
}

export async function cancelEmailChangeHandler(
  ctx: MutationCtx,
): Promise<null> {
  const {_id: userId, pendingEmail} = await requireUser(ctx);

  await rateLimiter.limit(ctx, 'cancelEmailChange', {
    key: userId,
    throws: true,
  });

  if (!pendingEmail) {
    // Nothing to cancel — return without writing to DB or audit log.
    return null;
  }

  await ctx.db.patch('users', userId, {
    pendingEmail: undefined,
  });

  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: userId,
      action: 'account.email_change.cancelled',
      source: 'account_settings',
    },
  );

  return null;
}

export async function requestEmailChangeHandler(
  ctx: MutationCtx,
  args: {
    newEmail: string;
    callbackURL?: string;
  },
): Promise<{success: boolean; message?: string}> {
  validateStringLength(args.newEmail, 'Email', MAX_EMAIL_LENGTH);
  if (args.callbackURL) {
    validateStringLength(
      args.callbackURL,
      'Callback URL',
      MAX_CALLBACK_URL_LENGTH,
    );
  }

  const appUser = await requireUser(ctx);
  const userId = appUser._id;
  await rateLimiter.limit(ctx, 'requestEmailChange', {
    key: userId,
    throws: true,
  });

  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: userId,
      action: 'account.email_change.requested',
      source: 'account_settings',
    },
  );

  const fail = async (
    message: string,
  ): Promise<{success: false; message: string}> => {
    await insertAdminAuditLog(
      {db: ctx.db, meta: ctx.meta},
      {
        adminId: userId,
        action: 'account.email_change.failed',
        source: 'account_settings',
      },
    );
    return {success: false, message};
  };

  const normalizedCurrentEmail = appUser.email
    ? normalizeEmail(appUser.email)
    : null;
  const normalizedNewEmail = normalizeEmail(args.newEmail);

  if (!normalizedNewEmail.includes('@')) {
    return await fail('Please enter a valid email address');
  }

  if (normalizedCurrentEmail && normalizedNewEmail === normalizedCurrentEmail) {
    return await fail('New email must be different from current email');
  }

  const exactConflict = await findConflictingEmailOwner(
    ctx,
    normalizedNewEmail,
    userId,
  );

  if (exactConflict) {
    return await fail('Email address already in use');
  }

  await ctx.db.patch('users', userId, {
    pendingEmail: normalizedNewEmail,
  });

  try {
    const {auth, headers} = await authComponent.getAuth(createAuth, ctx);

    await auth.api.changeEmail({
      body: {
        newEmail: normalizedNewEmail,
        callbackURL: args.callbackURL,
      },
      headers,
    });

    await insertAdminAuditLog(
      {db: ctx.db, meta: ctx.meta},
      {
        adminId: userId,
        action: 'account.email_change.verification_queued',
        source: 'account_settings',
      },
    );
    return {success: true};
  } catch (err: unknown) {
    await ctx.db.patch('users', userId, {
      pendingEmail: undefined,
    });
    return await fail(mapEmailChangeError(err));
  }
}
