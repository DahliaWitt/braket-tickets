import type {Doc, Id} from '../../_generated/dataModel';
import {adapterFindMany} from '../../lib/better_auth_adapter';
import type {AdminAuditAction} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {getAuditRequestFields} from '../../lib/request_metadata';
import {normalizeEmail, sanitizeName} from '../../lib/validation';
import {
  findConflictingEmailOwner,
  lookupUserByBetterAuthUserId,
  lookupUserByNormalizedEmail,
} from '../../lib/auth_identity';
import {findMatchingInQuery} from '../../lib/query_scan';
import {internal} from '../../_generated/api';
import type {MutationCtx} from '../../_generated/server';

const BACKFILL_BATCH = 100;
const BACKFILL_COLLISION_SAMPLE_LIMIT = 10;

/**
 * Lightweight check for unmigrated guest sessions. If any exist, schedule
 * a background action to migrate them — keeps the login path fast.
 */
async function scheduleGuestMigrationIfNeeded(
  ctx: MutationCtx,
  email: string,
  userId: Id<'users'>,
): Promise<void> {
  const guestSessionsQuery = ctx.db
    .query('guest_sessions')
    .withIndex('by_email', (q) => q.eq('email', email));
  const hasGuestSession = await findMatchingInQuery(
    guestSessionsQuery,
    (session) => !session.convertedToUserId,
  );

  if (hasGuestSession) {
    await ctx.scheduler.runAfter(
      0,
      internal.guest_sessions.core.migrateGuestToUser,
      {
        email,
        userId,
      },
    );
  }
}

function buildEmailVerificationFields(
  args: {
    authEmailVerified?: boolean;
    emailVerificationTime?: number;
  },
  options?: {
    existingUser?: Pick<
      Doc<'users'>,
      'authEmailVerified' | 'emailVerificationTime'
    >;
    synthesizeTimestampOnVerification?: boolean;
  },
): {
  authEmailVerified?: boolean;
  emailVerificationTime?: number;
} {
  if (args.authEmailVerified === undefined) {
    return {};
  }

  if (!args.authEmailVerified) {
    return {
      authEmailVerified: false,
    };
  }

  const existingUser = options?.existingUser;
  const hasExistingVerification = existingUser?.authEmailVerified === true;
  const explicitVerificationTime = args.emailVerificationTime;

  if (hasExistingVerification) {
    if (
      explicitVerificationTime !== undefined &&
      existingUser?.emailVerificationTime !== explicitVerificationTime
    ) {
      return {
        emailVerificationTime: explicitVerificationTime,
      };
    }

    return {};
  }

  return {
    authEmailVerified: true,
    ...(explicitVerificationTime !== undefined
      ? {emailVerificationTime: explicitVerificationTime}
      : options?.synthesizeTimestampOnVerification
        ? {emailVerificationTime: Date.now()}
        : {}),
  };
}

async function assertNoConflictingEmailOwner(
  ctx: MutationCtx,
  currentUserId: Id<'users'>,
  normalizedEmail: string,
): Promise<void> {
  const conflict = await findConflictingEmailOwner(
    ctx,
    normalizedEmail,
    currentUserId,
  );
  if (conflict) {
    throw new Error(
      `Cannot complete auth sync: email ${normalizedEmail} is already used by another user`,
    );
  }
}

function requireVerifiedIdentityEmail(args: {
  email?: string;
  authEmailVerified?: boolean;
}): string {
  if (!args.email) {
    throw new Error('Auth sync blocked: verified identity email is required');
  }

  if (args.authEmailVerified !== true) {
    throw new Error(
      'Auth sync blocked: unverified identity email cannot create or link users',
    );
  }

  return normalizeEmail(args.email);
}

async function insertUserScopedAuditLog(
  ctx: MutationCtx,
  userId: Id<'users'>,
  action: AdminAuditAction,
  reason?: string,
): Promise<void> {
  await insertAdminAuditLog(
    {db: ctx.db, meta: ctx.meta},
    {
      adminId: userId,
      action,
      source: 'better_auth_sync',
      ...(reason ? {reason} : {}),
    },
  );
}

function resolveExistingUserSocialSignupCompletion(
  existingUser: Pick<
    Doc<'users'>,
    'socialSignupCompletionRequired' | 'termsAcceptedAt'
  >,
  incomingValue: boolean | undefined,
): {
  requiresSocialSignupCompletion: boolean;
  updates: Partial<Pick<Doc<'users'>, 'socialSignupCompletionRequired'>>;
} {
  const existingRequiresSocialSignupCompletion =
    existingUser.socialSignupCompletionRequired === true;
  // socialSignupCompletionRequired gates terms acceptance, and sync is not a
  // terms-accepting flow: `incomingValue === false` only means a credential
  // account now exists on the Better Auth side (setPassword, password reset),
  // not that the user went through onboarding. Only clear the flag once
  // termsAcceptedAt is stamped; completeSocialSignupOnboarding stamps it and
  // clears the flag for users who still need onboarding.
  const shouldClearSocialSignupCompletion =
    incomingValue === false &&
    existingRequiresSocialSignupCompletion &&
    existingUser.termsAcceptedAt !== undefined;

  return {
    requiresSocialSignupCompletion: shouldClearSocialSignupCompletion
      ? false
      : existingRequiresSocialSignupCompletion,
    updates: shouldClearSocialSignupCompletion
      ? {socialSignupCompletionRequired: false}
      : {},
  };
}

export async function syncUserHandler(
  ctx: MutationCtx,
  args: {
    betterAuthUserId: string;
    email?: string;
    name?: string;
    image?: string;
    authEmailVerified?: boolean;
    emailVerificationTime?: number;
    socialSignupCompletionRequired?: boolean;
  },
): Promise<{
  userId: Id<'users'>;
  created: boolean;
  requiresSocialSignupCompletion: boolean;
}> {
  const safeName = sanitizeName(args.name);
  const normalizedEmail = args.email ? normalizeEmail(args.email) : undefined;

  const betterAuthMatch = await lookupUserByBetterAuthUserId(
    ctx,
    args.betterAuthUserId,
  );
  if (betterAuthMatch.collision) {
    throw new Error(
      'Data integrity error: multiple users linked to the same Better Auth identity',
    );
  }

  if (betterAuthMatch.user) {
    const verificationUpdates = buildEmailVerificationFields(args, {
      existingUser: betterAuthMatch.user,
      synthesizeTimestampOnVerification: true,
    });
    const socialSignupCompletionState =
      resolveExistingUserSocialSignupCompletion(
        betterAuthMatch.user,
        args.socialSignupCompletionRequired,
      );

    const verifiedEmail =
      args.authEmailVerified === true ? normalizedEmail : undefined;

    if (verifiedEmail) {
      await assertNoConflictingEmailOwner(
        ctx,
        betterAuthMatch.user._id,
        verifiedEmail,
      );
    }

    const shouldSetName =
      Boolean(safeName) &&
      (!betterAuthMatch.user.name ||
        (typeof betterAuthMatch.user.name === 'string' &&
          betterAuthMatch.user.name.trim().length === 0));
    const shouldSetEmail =
      verifiedEmail !== undefined &&
      normalizeEmail(betterAuthMatch.user.email ?? '') !== verifiedEmail;

    const updates: Partial<Doc<'users'>> = {
      ...(shouldSetName ? {name: safeName} : {}),
      ...(args.image && args.image !== betterAuthMatch.user.image
        ? {image: args.image}
        : {}),
      ...socialSignupCompletionState.updates,
      ...verificationUpdates,
      ...(shouldSetEmail
        ? {
            email: verifiedEmail,
            pendingEmail: undefined,
            emailChangeToken: undefined,
            emailChangeTokenExpiry: undefined,
            authEmailVerified: true,
            emailVerificationTime: args.emailVerificationTime ?? Date.now(),
          }
        : {}),
    };

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch('users', betterAuthMatch.user._id, updates);
    }

    if (verifiedEmail) {
      await scheduleGuestMigrationIfNeeded(
        ctx,
        verifiedEmail,
        betterAuthMatch.user._id,
      );
    }

    return {
      userId: betterAuthMatch.user._id,
      created: false,
      requiresSocialSignupCompletion:
        socialSignupCompletionState.requiresSocialSignupCompletion,
    };
  }

  const verifiedIdentityEmail = requireVerifiedIdentityEmail(args);
  const emailMatch = await lookupUserByNormalizedEmail(
    ctx,
    verifiedIdentityEmail,
  );

  if (emailMatch.collision) {
    throw new Error(
      'Data integrity error: multiple users share the same normalized email',
    );
  }

  if (emailMatch.user) {
    await assertNoConflictingEmailOwner(
      ctx,
      emailMatch.user._id,
      verifiedIdentityEmail,
    );

    const verificationUpdates = buildEmailVerificationFields(args, {
      existingUser: emailMatch.user,
      synthesizeTimestampOnVerification: true,
    });
    const socialSignupCompletionState =
      resolveExistingUserSocialSignupCompletion(
        emailMatch.user,
        args.socialSignupCompletionRequired,
      );

    const updates: Partial<Doc<'users'>> = {
      betterAuthUserId: args.betterAuthUserId,
      ...(safeName && !emailMatch.user.name ? {name: safeName} : {}),
      ...(args.image && args.image !== emailMatch.user.image
        ? {image: args.image}
        : {}),
      ...socialSignupCompletionState.updates,
      ...verificationUpdates,
    };

    await ctx.db.patch('users', emailMatch.user._id, updates);
    await scheduleGuestMigrationIfNeeded(
      ctx,
      verifiedIdentityEmail,
      emailMatch.user._id,
    );
    await insertUserScopedAuditLog(
      ctx,
      emailMatch.user._id,
      'auth.social_signin.linked_existing',
    );
    return {
      userId: emailMatch.user._id,
      created: false,
      requiresSocialSignupCompletion:
        socialSignupCompletionState.requiresSocialSignupCompletion,
    };
  }

  const userId = await ctx.db.insert('users', {
    email: verifiedIdentityEmail,
    name: safeName,
    image: args.image,
    betterAuthUserId: args.betterAuthUserId,
    ...buildEmailVerificationFields(args, {
      synthesizeTimestampOnVerification: true,
    }),
    socialSignupCompletionRequired:
      args.socialSignupCompletionRequired === true,
  });

  await scheduleGuestMigrationIfNeeded(ctx, verifiedIdentityEmail, userId);
  return {
    userId,
    created: true,
    requiresSocialSignupCompletion:
      args.socialSignupCompletionRequired === true,
  };
}

export async function backfillAuthUserLinksHandler(
  ctx: MutationCtx,
  args: {
    cursor?: string | null;
    actorUserId?: Id<'users'>;
  },
): Promise<{
  processed: number;
  linked: number;
  skipped: number;
  collisions: number;
  continueCursor: string | null;
  isDone: boolean;
  collisionSample: string[];
}> {
  const result = await ctx.db
    .query('users')
    .order('asc')
    .paginate({
      numItems: BACKFILL_BATCH,
      cursor: args.cursor ?? null,
    });

  let processed = 0;
  let linked = 0;
  let skipped = 0;
  let collisions = 0;
  const collisionSample: string[] = [];

  // Resolve request metadata once for the whole batch: this handler inserts one
  // audit row per user, so passing the fields explicitly (with meta omitted)
  // keeps insertAdminAuditLog from re-invoking the syscall on every iteration.
  const auditFields = args.actorUserId ? await getAuditRequestFields(ctx) : {};
  const recordBackfillAudit = async (
    action: AdminAuditAction,
    reason?: string,
  ): Promise<void> => {
    if (!args.actorUserId) {
      return;
    }

    await insertAdminAuditLog(
      {db: ctx.db},
      {
        adminId: args.actorUserId,
        action,
        source: 'auth_sync_backfill',
        ...auditFields,
        ...(reason ? {reason} : {}),
      },
    );
  };

  for (const user of result.page) {
    processed += 1;

    if (user.betterAuthUserId) {
      skipped += 1;
      await recordBackfillAudit('auth_sync.backfill.skipped', 'already_linked');
      continue;
    }

    if (!user.email) {
      skipped += 1;
      await recordBackfillAudit('auth_sync.backfill.skipped', 'missing_email');
      continue;
    }

    const normalizedEmail = normalizeEmail(user.email);
    const appEmailLookup = await lookupUserByNormalizedEmail(
      ctx,
      normalizedEmail,
    );

    if (appEmailLookup.collision) {
      collisions += 1;
      skipped += 1;
      if (collisionSample.length < BACKFILL_COLLISION_SAMPLE_LIMIT) {
        collisionSample.push(
          `app_email_collision:${user._id}:${normalizedEmail}`,
        );
      }
      await recordBackfillAudit(
        'auth_sync.backfill.collision',
        'duplicate_app_email',
      );
      continue;
    }

    const authUsers = await adapterFindMany(ctx, {
      model: 'user',
      where: [{field: 'email', operator: 'eq', value: normalizedEmail}],
      paginationOpts: {
        numItems: 2,
        cursor: null,
      },
    });

    if (authUsers.length !== 1) {
      collisions += 1;
      skipped += 1;
      if (collisionSample.length < BACKFILL_COLLISION_SAMPLE_LIMIT) {
        collisionSample.push(
          `auth_email_collision:${user._id}:${normalizedEmail}`,
        );
      }
      await recordBackfillAudit(
        'auth_sync.backfill.collision',
        'auth_user_lookup',
      );
      continue;
    }

    const authUserId =
      typeof authUsers[0]._id === 'string' ? authUsers[0]._id : null;
    if (!authUserId) {
      skipped += 1;
      await recordBackfillAudit(
        'auth_sync.backfill.skipped',
        'missing_auth_user_id',
      );
      continue;
    }

    const linkedAuthUser = await lookupUserByBetterAuthUserId(ctx, authUserId);
    if (
      linkedAuthUser.collision ||
      (linkedAuthUser.user && linkedAuthUser.user._id !== user._id)
    ) {
      collisions += 1;
      skipped += 1;
      if (collisionSample.length < BACKFILL_COLLISION_SAMPLE_LIMIT) {
        collisionSample.push(`ba_id_collision:${user._id}:${authUserId}`);
      }
      await recordBackfillAudit(
        'auth_sync.backfill.collision',
        'better_auth_user_claimed',
      );
      continue;
    }

    const authEmailVerified = authUsers[0].emailVerified === true;
    await ctx.db.patch('users', user._id, {
      betterAuthUserId: authUserId,
      ...buildEmailVerificationFields(
        {
          authEmailVerified,
          emailVerificationTime: user.emailVerificationTime,
        },
        {
          existingUser: user,
          synthesizeTimestampOnVerification: false,
        },
      ),
    });

    linked += 1;
    await recordBackfillAudit('auth_sync.backfill.linked', authUserId);
  }

  return {
    processed,
    linked,
    skipped,
    collisions,
    continueCursor: result.continueCursor,
    isDone: result.isDone,
    collisionSample,
  };
}
