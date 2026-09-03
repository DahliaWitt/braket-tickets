import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from '@convex-dev/better-auth';
import {convex, crossDomain} from '@convex-dev/better-auth/plugins';
import {betterAuth, type BetterAuthPlugin} from 'better-auth';
import {createAuthMiddleware} from 'better-auth/api';
import {generateRandomString} from 'better-auth/crypto';
import {haveIBeenPwned} from 'better-auth/plugins';
import {COMPROMISED_PASSWORD_MESSAGE} from '@shared/constants';

import {components, internal} from '../_generated/api';
import type {DataModel, Doc} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import authConfig from '../auth.config';
import {adapterFindMany} from './better_auth_adapter';
import {insertAdminAuditLog} from './admin_audit_log';
import {
  findConflictingEmailOwner,
  lookupUserByBetterAuthUserIdOrThrow,
  lookupUserByNormalizedEmailOrThrow,
} from './auth_identity';
import {
  emailChangeConfirmationTemplate,
  passwordResetTemplate,
  verificationTemplate,
} from '../email/templates';
import {
  enqueueEmailDelivery,
  sendEmailDeliveryNow,
} from './email_delivery_wrapper';
import {hasConfiguredCriticalEmailCredentials} from './email_delivery_mode';
import {resolveSiteUrl} from './site_url';
import {normalizeEmail, sanitizeName} from './validation';
import {logger} from './logger';
import {isHibpPasswordCheckDisabled, isTestEnvironment} from './environment';

type EmailSendPayload = {
  to: string;
  subject: string;
  html: string;
};

const LOCAL_FRONTEND_PORTS = ['4200', '4201', '4202'] as const;

async function dispatchEmailSend(
  ctx: GenericCtx<DataModel>,
  payload: EmailSendPayload,
  options: {requireDelivery?: boolean} = {},
): Promise<void> {
  const metadata = {
    source: 'auth' as const,
    // Constant sourceId so the (source, sourceId) index does not embed
    // recipient-email PII. Admins filter per-email via the `recipient`
    // field on `emailDeliveryFailures` rows.
    sourceId: 'dispatch',
    recipient: payload.to,
    critical: true,
    requireDelivery: options.requireDelivery,
  };
  if ('runAction' in ctx) {
    await sendEmailDeliveryNow(ctx, payload, metadata);
    return;
  }

  if ('scheduler' in ctx) {
    if (
      options.requireDelivery &&
      !isTestEnvironment() &&
      !hasConfiguredCriticalEmailCredentials()
    ) {
      throw new Error('Email delivery is required but not configured');
    }
    await enqueueEmailDelivery(ctx, payload, metadata);
    return;
  }

  throw new Error('Mutation or action context required for email delivery');
}

/**
 * Sends the email-change confirmation to the user's CURRENT address.
 *
 * Exported so contract tests can exercise the exact production dispatch —
 * template, requireDelivery flag, and provider args — end to end. The vitest
 * setup mocks authComponent.getAuth (Better Auth's HTTP layer), so nothing
 * above this function is reachable in convex-test; this is the highest
 * production-shaped entry point for the email-change delivery contract.
 */
export async function dispatchEmailChangeConfirmation(
  ctx: GenericCtx<DataModel>,
  args: {to: string; newEmail: string; url: string},
): Promise<void> {
  const {subject, html} = emailChangeConfirmationTemplate(
    args.newEmail,
    args.url,
  );
  await dispatchEmailSend(
    ctx,
    {to: args.to, subject, html},
    {requireDelivery: true},
  );
}

/**
 * Custom plugin to add OTT (one-time token) to verify-email redirects.
 *
 * DELIBERATE reimplementation, NOT dead code — do not delete. The
 * @convex-dev/better-auth 0.12.5 crossDomain plugin attaches its OTT after-hook
 * only to `/callback`, `/oauth2/callback`, and `/magic-link/verify` (see its
 * `crossDomain` server plugin), and never to `/verify-email`. Without this
 * plugin, cross-domain email-verification sign-in silently loses the session on
 * the redirect back to the app: the browser lands on the app origin with no
 * usable credential because the crossDomain flow relies on the OTT query param,
 * not a third-party cookie.
 *
 * This gap is masked in E2E, which runs in cookie mode (crossDomain disabled on
 * both client and server), so no automated test would catch a regression here.
 *
 * Retire this plugin ONLY once upstream's crossDomain OTT hook covers
 * `/verify-email` redirects. Tracking: the PR that introduced this refactor
 * drafts an upstream issue for get-convex/better-auth requesting exactly that.
 */
const verifyEmailOttPlugin = (): BetterAuthPlugin => ({
  id: 'verify-email-ott',
  hooks: {
    after: [
      {
        matcher: (ctx) => ctx.path?.startsWith('/verify-email') ?? false,
        handler: createAuthMiddleware(async (ctx) => {
          const session = ctx.context.newSession;
          if (!session) {
            return;
          }

          const redirectTo = ctx.context.responseHeaders?.get('location');
          if (!redirectTo) {
            return;
          }

          const token = generateRandomString(32);
          const expiresAt = new Date(Date.now() + 3 * 60 * 1000);

          await ctx.context.internalAdapter.createVerificationValue({
            value: session.session.token,
            identifier: `one-time-token:${token}`,
            expiresAt,
          });

          const url = new URL(redirectTo);
          url.searchParams.set('ott', token);

          throw ctx.redirect(url.toString());
        }),
      },
    ],
  },
});

export async function getSocialSignupCompletionRequired(
  ctx: Parameters<typeof adapterFindMany>[0],
  betterAuthUserId: string,
): Promise<boolean> {
  const accounts = await adapterFindMany(ctx, {
    model: 'account',
    where: [{field: 'userId', operator: 'eq', value: betterAuthUserId}],
    paginationOpts: {numItems: 10, cursor: null},
  });

  return !accounts.some((account) => account['providerId'] === 'credential');
}

// Component adapter writes call back into app triggers through function handles.
const authFunctions: AuthFunctions = internal.lib.better_auth;

async function syncAuthUserToAppIfEligible(
  ctx: MutationCtx,
  authUser: {
    _id: string;
    email?: string | null;
    emailVerified?: boolean | null;
    name?: string | null;
    image?: string | null;
  },
): Promise<void> {
  if (!authUser.email || authUser.emailVerified !== true) {
    return;
  }

  await ctx.runMutation(internal.auth.sync.syncUser, {
    betterAuthUserId: authUser._id,
    email: normalizeEmail(authUser.email),
    name: authUser.name ?? undefined,
    image: authUser.image ?? undefined,
    authEmailVerified: true,
    socialSignupCompletionRequired: await getSocialSignupCompletionRequired(
      ctx,
      authUser._id,
    ),
  });
}

async function syncAuthUserProfileFields(
  ctx: MutationCtx,
  appUser: Doc<'users'>,
  authUser: {
    name?: string | null;
    image?: string | null;
  },
): Promise<void> {
  const safeName = sanitizeName(authUser.name ?? undefined);
  const updates: Partial<Pick<Doc<'users'>, 'name' | 'image'>> = {
    ...(safeName &&
    (!appUser.name ||
      (typeof appUser.name === 'string' && appUser.name.trim().length === 0))
      ? {name: safeName}
      : {}),
    ...(authUser.image && authUser.image !== appUser.image
      ? {image: authUser.image}
      : {}),
  };

  if (Object.keys(updates).length > 0) {
    await ctx.db.patch('users', appUser._id, updates);
  }
}

async function findBetterAuthUserById(
  ctx: MutationCtx,
  betterAuthUserId: string,
): Promise<{
  _id: string;
  email?: string | null;
  emailVerified?: boolean | null;
  name?: string | null;
  image?: string | null;
} | null> {
  const [authUser] = await adapterFindMany(ctx, {
    model: 'user',
    where: [{field: '_id', operator: 'eq', value: betterAuthUserId}],
    paginationOpts: {numItems: 1, cursor: null},
  });

  if (!authUser || typeof authUser._id !== 'string') {
    return null;
  }

  return {
    _id: authUser._id,
    email: typeof authUser.email === 'string' ? authUser.email : null,
    emailVerified: authUser.emailVerified === true,
    name: typeof authUser.name === 'string' ? authUser.name : null,
    image: typeof authUser.image === 'string' ? authUser.image : null,
  };
}

async function syncAuthUserByIdIfEligible(
  ctx: MutationCtx,
  betterAuthUserId: string | null | undefined,
): Promise<void> {
  if (!betterAuthUserId) {
    return;
  }

  const authUser = await findBetterAuthUserById(ctx, betterAuthUserId);
  if (!authUser) {
    return;
  }

  await syncAuthUserToAppIfEligible(ctx, authUser);
}

export function resolveSocialProviderAvailability(): {
  google: boolean;
  discord: boolean;
} {
  const google = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const discord = Boolean(
    process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET,
  );

  return {google, discord};
}

function buildAllowedFrontendOrigins(frontendUrl: string): Set<string> {
  const allowedOrigins = new Set<string>([new URL(frontendUrl).origin]);
  const authBaseUrl =
    process.env.CONVEX_SITE_URL || process.env.AUTH_BASE_URL || '';
  const isLocalDevelopment =
    authBaseUrl.includes('127.0.0.1') || authBaseUrl.includes('localhost');
  const allowLocalhost = process.env.ALLOW_LOCALHOST_CORS === 'true';

  if (allowLocalhost || isLocalDevelopment) {
    for (const port of LOCAL_FRONTEND_PORTS) {
      allowedOrigins.add(`http://localhost:${port}`);
      allowedOrigins.add(`http://127.0.0.1:${port}`);
    }
  }

  return allowedOrigins;
}

export function sanitizeFrontendCallbackUrl(
  rawValue: string | null,
  frontendUrl: string,
  fallbackPath: string,
): string {
  const fallback = new URL(fallbackPath, frontendUrl).toString();
  const allowedOrigins = buildAllowedFrontendOrigins(frontendUrl);
  if (!rawValue || rawValue === '/') {
    return fallback;
  }

  // Reject backslashes outright. The WHATWG URL parser (and every browser)
  // normalizes `\` to `/` for http/https, so inputs like `/\evil.com`,
  // `/\/evil.com`, or `\/\/evil.com` resolve to a protocol-relative external
  // origin and slip past a naive `startsWith('//')` guard. No legitimate
  // in-app callback path contains a backslash.
  if (rawValue.includes('\\')) {
    return fallback;
  }

  // Resolve the value against the frontend origin and accept it only when the
  // fully-resolved origin is on the allowlist. Resolving first, then checking
  // the origin, uniformly rejects protocol-relative (`//host`),
  // absolute-external, userinfo (`user@host`), and opaque-scheme
  // (`javascript:`/`data:`, whose origin is "null") URLs regardless of how they
  // are spelled, while preserving same-origin relative paths and trusted
  // absolute URLs. The origin — not a string prefix — is authoritative for
  // where the browser will navigate.
  let resolved: URL;
  try {
    resolved = new URL(rawValue, frontendUrl);
  } catch {
    return fallback;
  }

  // Only http(s) redirect targets are valid in-app navigations. A value such as
  // `blob:https://app.example.com/<uuid>` resolves to a trusted `origin` and
  // would otherwise pass the allowlist, yet it is not a real page navigation.
  // The frontend allowlist itself only ever contains http/https origins.
  if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') {
    return fallback;
  }

  if (!allowedOrigins.has(resolved.origin)) {
    return fallback;
  }

  return resolved.toString();
}

export function buildFrontendCallbackUrl(
  rawValue: string | null | undefined,
  fallbackPath: string,
): string {
  return sanitizeFrontendCallbackUrl(
    rawValue ?? null,
    resolveSiteUrl(),
    fallbackPath,
  );
}

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, authUser) => {
        await syncAuthUserToAppIfEligible(ctx, authUser);
      },
      onUpdate: async (ctx, authUser, previousAuthUser) => {
        if (authUser.email !== previousAuthUser.email) {
          const appUser =
            (await lookupUserByBetterAuthUserIdOrThrow(ctx, authUser._id)) ??
            (previousAuthUser.email
              ? await lookupUserByNormalizedEmailOrThrow(
                  ctx,
                  normalizeEmail(previousAuthUser.email),
                )
              : null);

          if (!appUser || !authUser.email || authUser.emailVerified !== true) {
            return;
          }

          const nextEmail = normalizeEmail(authUser.email);

          // Only finalize email changes that still have an active matching
          // pending email request in the app user record.
          if (
            !appUser.pendingEmail ||
            normalizeEmail(appUser.pendingEmail) !== nextEmail
          ) {
            await syncAuthUserProfileFields(ctx, appUser, authUser);
            return;
          }

          const conflictingUser = await findConflictingEmailOwner(
            ctx,
            nextEmail,
            appUser._id,
          );

          if (conflictingUser) {
            throw new Error(
              `Cannot complete email change: email ${nextEmail} is already used by another user`,
            );
          }

          await ctx.db.patch('users', appUser._id, {
            email: nextEmail,
            betterAuthUserId: authUser._id,
            pendingEmail: undefined,
            emailChangeToken: undefined,
            emailChangeTokenExpiry: undefined,
            authEmailVerified: true,
            emailVerificationTime: Date.now(),
          });

          await insertAdminAuditLog(
            {db: ctx.db, meta: ctx.meta},
            {
              adminId: appUser._id,
              action: 'account.email_change.completed',
              source: 'better_auth_trigger',
            },
          );

          return;
        }

        await syncAuthUserToAppIfEligible(ctx, {
          _id: authUser._id,
          email: authUser.email ?? previousAuthUser.email,
          emailVerified:
            authUser.emailVerified ?? previousAuthUser.emailVerified,
          name: authUser.name ?? previousAuthUser.name,
          image: authUser.image ?? previousAuthUser.image,
        });
      },
    },
    account: {
      onCreate: async (ctx, account) => {
        await syncAuthUserByIdIfEligible(
          ctx,
          typeof account.userId === 'string' ? account.userId : null,
        );

        if (!['google', 'discord'].includes(account.providerId)) {
          return;
        }

        const appUser = await lookupUserByBetterAuthUserIdOrThrow(
          ctx,
          account.userId,
        );
        if (!appUser) {
          return;
        }

        const linkedAccounts = await adapterFindMany(ctx, {
          model: 'account',
          where: [{field: 'userId', value: account.userId}],
          paginationOpts: {
            numItems: 2,
            cursor: null,
          },
        });

        if (linkedAccounts.length <= 1) {
          return;
        }

        await insertAdminAuditLog(
          {db: ctx.db, meta: ctx.meta},
          {
            adminId: appUser._id,
            action: 'account.provider.linked',
            source: 'better_auth_account_trigger',
            reason: account.providerId,
          },
        );
      },
    },
    session: {
      onCreate: async (ctx, session) => {
        await syncAuthUserByIdIfEligible(
          ctx,
          typeof session.userId === 'string' ? session.userId : null,
        );
      },
    },
  },
});

export const {onCreate, onUpdate, onDelete} = authComponent.triggersApi();

/**
 * Resolves the Better Auth base URL from environment variables.
 * Throws if neither CONVEX_SITE_URL nor AUTH_BASE_URL is set.
 */
export function resolveAuthBaseUrl(): string {
  const url = process.env.CONVEX_SITE_URL || process.env.AUTH_BASE_URL;
  if (!url) {
    throw new Error(
      'AUTH_BASE_URL or CONVEX_SITE_URL must be set. ' +
        'Set AUTH_BASE_URL to your Convex site URL (e.g. https://<deployment>.convex.site).',
    );
  }
  return url;
}

function getAuthConfig() {
  const FRONTEND_URL = resolveSiteUrl();
  const AUTH_BASE_URL = resolveAuthBaseUrl();

  const isLocalDevelopment =
    AUTH_BASE_URL.includes('127.0.0.1') || AUTH_BASE_URL.includes('localhost');

  const allowLocalhost = process.env.ALLOW_LOCALHOST_CORS === 'true';
  const trustedOriginSet = new Set<string>([FRONTEND_URL]);

  if (allowLocalhost) {
    trustedOriginSet.add('http://localhost:4200');
    trustedOriginSet.add('http://127.0.0.1:4200');
  }

  if (isLocalDevelopment) {
    for (const port of LOCAL_FRONTEND_PORTS) {
      trustedOriginSet.add(`http://localhost:${port}`);
      trustedOriginSet.add(`http://127.0.0.1:${port}`);
    }
    // E2E global.setup.ts sends Origin: AUTH_URL (Convex site URL) for
    // sign-in/sign-up requests. Trust the auth base URL itself so these
    // same-origin requests are not rejected as cross-domain.
    trustedOriginSet.add(AUTH_BASE_URL);
  }

  const trustedOrigins = Array.from(trustedOriginSet);

  return {FRONTEND_URL, AUTH_BASE_URL, isLocalDevelopment, trustedOrigins};
}

/**
 * Better Auth paths guarded by the haveIBeenPwned breach check.
 *
 * Both are served through Better Auth HTTP routes registered as Convex
 * httpActions (backend/convex/http.ts), so the plugin's outbound fetch to
 * the HIBP range API is permitted. The /change-password HTTP route is
 * disabled below; the V2 action invokes auth.api.changePassword directly and
 * intentionally keeps the existing no-HIBP policy. The mutation-context
 * /set-password flow must never appear here because Convex mutations cannot
 * fetch and the plugin fails closed.
 */
export const HIBP_CHECKED_PATHS = [
  '/sign-up/email',
  '/reset-password',
] as const;

/**
 * Creates a Better Auth instance with Convex integration.
 */
export const createAuth = (ctx: GenericCtx<DataModel>) => {
  const {FRONTEND_URL, AUTH_BASE_URL, isLocalDevelopment, trustedOrigins} =
    getAuthConfig();
  const providerAvailability = resolveSocialProviderAvailability();
  const isE2ETest = isTestEnvironment();

  return betterAuth({
    baseURL: AUTH_BASE_URL,
    database: authComponent.adapter(ctx),
    trustedOrigins,
    // Password changes must pass through auth.public.changePasswordV2 so the
    // committed per-user rate limit cannot roll back on an invalid password.
    // disabledPaths affects only Better Auth's HTTP router; the V2 action can
    // still invoke auth.api.changePassword directly on the server.
    disabledPaths: ['/change-password'],
    advanced: {
      useSecureCookies: !isLocalDevelopment,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({user, url}) => {
        const {subject, html} = passwordResetTemplate(url);
        await dispatchEmailSend(ctx, {
          to: user.email,
          subject,
          html,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({user, url}) => {
        const verifyUrl = new URL(url);
        verifyUrl.searchParams.set(
          'callbackURL',
          sanitizeFrontendCallbackUrl(
            verifyUrl.searchParams.get('callbackURL'),
            FRONTEND_URL,
            '/confirm/verification',
          ),
        );

        const finalUrl = verifyUrl.toString();
        const {subject, html} = verificationTemplate(finalUrl);

        try {
          await dispatchEmailSend(ctx, {
            to: user.email,
            subject,
            html,
          });
        } catch (error: unknown) {
          logger.warn(
            'auth',
            'Failed to send verification email; continuing verification request',
            error,
          );
          // Don't throw — we don't want to block the verification request.
        }
      },
    },
    user: {
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({user, newEmail, url}) => {
          await dispatchEmailChangeConfirmation(ctx, {
            to: user.email,
            newEmail,
            url,
          });
        },
      },
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        enabled: providerAvailability.google,
      },
      discord: {
        clientId: process.env.DISCORD_CLIENT_ID || '',
        clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
        enabled: providerAvailability.discord,
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
        updateUserInfoOnLink: false,
      },
    },
    session: {
      // 60-day sliding window; the 7-day default logged out attendees
      // who only return when the next event comes around.
      expiresIn: 60 * 60 * 24 * 60,
      updateAge: 60 * 60 * 24,
      // Better Auth session cookie cache keeps repeated getSession() calls cheap
      // without making the client stateful. Five minutes is conservative enough
      // for auth bootstrap while still reducing repeated token/session round-trips.
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
    plugins: [
      convex({
        authConfig,
        jwksRotateOnTokenGenerationError: true,
      }),
      ...(isE2ETest ? [] : [crossDomain({siteUrl: FRONTEND_URL})]),
      ...(isE2ETest ? [] : [verifyEmailOttPlugin()]),
      // Breached-password check via the HIBP range API (k-anonymity; only a
      // 5-char SHA-1 prefix leaves the deployment). Excluded in E2E/local
      // test runs so tests never depend on an external service, and behind
      // AUTH_HIBP_DISABLED as an incident kill switch because the plugin
      // fails closed when the HIBP API is unreachable.
      ...(isE2ETest || isHibpPasswordCheckDisabled()
        ? []
        : [
            haveIBeenPwned({
              // Only paths served through Better Auth HTTP routes (Convex
              // httpActions, where outbound fetch is permitted). Deliberately
              // drops /change-password from the plugin defaults: breach
              // screening is intentionally scoped to sign-up and password
              // reset, not authenticated password changes. The legacy
              // HTTP route is disabled, and the rollout-only legacy mutation
              // rejects stale clients before reaching Better Auth. V2 runs as
              // an action but preserves the same screening policy.
              // /set-password (also mutation context) was never a plugin
              // default and remains out.
              paths: [...HIBP_CHECKED_PATHS],
              customPasswordCompromisedMessage: COMPROMISED_PASSWORD_MESSAGE,
            }),
          ]),
    ],
  });
};
