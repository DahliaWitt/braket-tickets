'use node';

import {v} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import {internal} from '../_generated/api';
import type {ActionCtx} from '../_generated/server';
import {adapterUpdateOne} from '../lib/better_auth_adapter';
import {logger} from '../lib/logger';
import {resolveSiteUrl} from '../lib/site_url';
import {seedUserAndGetTokensResultValidator, testingAction} from './wrappers';
import {
  findBetterAuthUserByEmailWithRetry,
  getBetterAuthRecordId,
  getBetterAuthUserIdFromResponseBody,
} from './users';

const BETTER_AUTH_RETRY_DELAYS_MS = [0, 250, 750, 1500, 3000, 5000] as const;

interface BetterAuthSignUpResult {
  ok: boolean;
  status: number;
  body: unknown;
  responseBody: string;
}

function parseResponseBody(responseBody: string): unknown {
  try {
    return JSON.parse(responseBody);
  } catch {
    return null;
  }
}

function shouldRetryBetterAuthSignUp(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function signUpBetterAuthUserWithRetry({
  convexSiteUrl,
  frontendUrl,
  email,
  password,
  displayName,
}: {
  convexSiteUrl: string;
  frontendUrl: string;
  email: string;
  password: string;
  displayName: string;
}): Promise<BetterAuthSignUpResult> {
  let lastResult: BetterAuthSignUpResult | null = null;

  for (
    let attemptIndex = 0;
    attemptIndex < BETTER_AUTH_RETRY_DELAYS_MS.length;
    attemptIndex += 1
  ) {
    const delayMs = BETTER_AUTH_RETRY_DELAYS_MS[attemptIndex];
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const response = await fetch(`${convexSiteUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: frontendUrl,
      },
      body: JSON.stringify({email, password, name: displayName}),
    });
    const responseBody = await response.text();
    const result: BetterAuthSignUpResult = {
      ok: response.ok,
      status: response.status,
      body: parseResponseBody(responseBody),
      responseBody,
    };
    lastResult = result;

    const isFinalAttempt =
      attemptIndex === BETTER_AUTH_RETRY_DELAYS_MS.length - 1;
    if (
      result.ok ||
      isFinalAttempt ||
      !shouldRetryBetterAuthSignUp(result.status)
    ) {
      return result;
    }

    logger.warn(
      'testing_functions',
      '[seedUserAndGetTokens] Sign-up failed; retrying',
      {
        email,
        status: result.status,
        attempt: attemptIndex + 1,
        responseBody: result.responseBody,
      },
    );
  }

  if (!lastResult) {
    throw new Error('Better Auth sign-up did not run');
  }
  return lastResult;
}

export const seedUserAndGetTokensArgsValidator = {
  email: v.string(),
  password: v.string(),
  name: v.string(),
  verifyBetterAuth: v.optional(v.boolean()),
  includeAuthArtifacts: v.optional(v.boolean()),
};

interface SeedUserAndGetTokensArgs {
  email: string;
  password: string;
  name: string;
  verifyBetterAuth?: boolean;
  includeAuthArtifacts?: boolean;
}

export async function seedUserAndGetTokensImpl(
  ctx: ActionCtx,
  {
    email,
    password,
    name: displayName,
    verifyBetterAuth,
    includeAuthArtifacts,
  }: SeedUserAndGetTokensArgs,
): Promise<{
  token: string;
  refreshToken: string;
  userId: Id<'users'>;
  email: string;
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    sameSite?: 'Strict' | 'Lax' | 'None';
    httpOnly: boolean;
    secure: boolean;
  }[];
}> {
  // Get the Convex site URL for Better Auth HTTP endpoints (port 3211)
  const convexSiteUrl =
    process.env.E2E_CONVEX_SITE_URL ||
    process.env.CONVEX_SITE_URL ||
    'http://127.0.0.1:3211';

  // Frontend URL for CORS Origin header. In E2E/dev runs SITE_URL is
  // always set by scripts/lib/shared.ts to the harness's frontend port
  // (4201). In the rare case SITE_URL is unset, resolveSiteUrl() falls
  // back to the localhost:4200 default — that path should not fire in CI.
  const frontendUrl = resolveSiteUrl();
  let betterAuthUserId: string | undefined;
  let authEmailVerified = false;

  // 1. Try to sign up first (creates user in Better Auth)
  // With email verification enabled, sign-up doesn't return tokens
  const signUpResult = await signUpBetterAuthUserWithRetry({
    convexSiteUrl,
    frontendUrl,
    email,
    password,
    displayName,
  });

  betterAuthUserId = getBetterAuthUserIdFromResponseBody(signUpResult.body);
  if (betterAuthUserId !== undefined) {
    const rawUser =
      typeof signUpResult.body === 'object' && signUpResult.body !== null
        ? (signUpResult.body as Record<string, unknown>)['user']
        : null;
    if (typeof rawUser === 'object' && rawUser !== null) {
      authEmailVerified =
        (rawUser as Record<string, unknown>)['emailVerified'] === true;
    }
  }

  if (!signUpResult.ok) {
    logger.warn('testing_functions', '[seedUserAndGetTokens] Sign-up failed', {
      email,
      status: signUpResult.status,
      responseBody: signUpResult.responseBody,
    });
  }

  // 2. Verify Better Auth account by default (required since requireEmailVerification: true).
  // Pass verifyBetterAuth: false to skip (e.g. for testing the verification gate).
  //
  // Inline the BA verification instead of delegating to verifyAccountAndUser mutation.
  // When a mutation calls ctx.runQuery(component), both share a 1s execution budget.
  // Under shard load (3+ parallel Playwright processes), the component query alone
  // exceeds 1s. By calling the component query/mutation directly from this action,
  // each gets its own execution budget.
  if (verifyBetterAuth !== false) {
    // Verify app user table
    await ctx.runMutation(
      internal.testing.users._verifyAccountAndUserInternal,
      {
        email,
      },
    );

    // Verify BA user separately (each call gets its own execution budget)
    const authUser = await findBetterAuthUserByEmailWithRetry(ctx, email);
    const resolvedAuthUserId = getBetterAuthRecordId(authUser);

    if (typeof resolvedAuthUserId === 'string') {
      betterAuthUserId = resolvedAuthUserId;
      await adapterUpdateOne(ctx, {
        model: 'user',
        where: [{field: '_id', operator: 'eq', value: resolvedAuthUserId}],
        update: {
          emailVerified: true,
          updatedAt: Date.now(),
        },
      });
      authEmailVerified = true;
    }
  }

  if (betterAuthUserId === undefined) {
    const authUser = await findBetterAuthUserByEmailWithRetry(ctx, email);
    const resolvedAuthUserId = getBetterAuthRecordId(authUser);
    if (typeof resolvedAuthUserId === 'string') {
      betterAuthUserId = resolvedAuthUserId;
      authEmailVerified = authUser?.['emailVerified'] === true;
    }
  }

  if (
    betterAuthUserId === undefined &&
    !signUpResult.ok &&
    shouldRetryBetterAuthSignUp(signUpResult.status)
  ) {
    throw new Error(
      `Better Auth sign-up failed after retry: ${signUpResult.status} ${signUpResult.responseBody}`,
    );
  }

  // Return the canonical app user linked to the Better Auth identity so
  // test fixtures attach tickets and roles to the same user the browser
  // will resolve after login.
  let userId: Id<'users'>;
  if (betterAuthUserId !== undefined) {
    const syncResult: {userId: Id<'users'>} = await ctx.runMutation(
      internal.auth.sync.syncUser,
      {
        betterAuthUserId,
        email: email.trim().toLowerCase(),
        name: displayName,
        authEmailVerified,
      },
    );
    userId = syncResult.userId;
  } else {
    // Fallback for unexpected Better Auth adapter failures during test seeding.
    const existingUser = await ctx.runQuery(
      internal.testing.users._getByEmailInternal,
      {email},
    );

    if (!existingUser) {
      userId = (await ctx.runMutation(
        internal.testing.users._createUserDirectlyInternal,
        {
          email,
          name: displayName,
        },
      )) as Id<'users'>;
    } else {
      userId = existingUser._id;
    }
  }

  // Most E2E tests only need a seeded identity, not auth tokens/cookies.
  // Avoiding the extra sign-in request significantly reduces Better Auth adapter load.
  if (!includeAuthArtifacts) {
    logger.warn(
      'testing_functions',
      '[seedUserAndGetTokens] Returning empty auth artifacts. Pass includeAuthArtifacts=true if tokens/cookies are needed',
      {email},
    );
    return {
      token: '',
      refreshToken: '',
      userId,
      email,
      cookies: [],
    };
  }

  // 4. Optional legacy path: sign in to collect auth artifacts.
  const signInResponse = await fetch(
    `${convexSiteUrl}/api/auth/sign-in/email`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: frontendUrl,
      },
      body: JSON.stringify({email, password}),
    },
  );

  if (!signInResponse.ok) {
    const errorText = await signInResponse.text();
    throw new Error(`Sign-in failed: ${signInResponse.status} ${errorText}`);
  }

  // Better Auth returns convex_jwt in cookie form.
  const rawCookie = signInResponse.headers.get('set-cookie') || '';
  const jwtMatch = rawCookie.match(
    /(?:__Secure-)?better-auth\.convex_jwt=([^;]+)/,
  );
  if (!jwtMatch) {
    throw new Error(
      `No convex_jwt cookie in response. Cookies: ${rawCookie.substring(0, 200)}`,
    );
  }

  const token = jwtMatch[1];
  const cookieStrings = rawCookie.split(/,(?=\s*(?:__Secure-|better-auth\.))/);
  const cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    sameSite?: 'Strict' | 'Lax' | 'None';
    httpOnly: boolean;
    secure: boolean;
  }[] = [];

  for (const cookieStr of cookieStrings) {
    const parts = cookieStr.split(';');
    const [nameValue] = parts;
    const eqIndex = nameValue.indexOf('=');
    if (eqIndex <= 0) continue;

    const name = nameValue.substring(0, eqIndex).trim();
    const value = nameValue.substring(eqIndex + 1).trim();
    if (!name || !value) continue;

    let path = '/';
    let sameSite: 'Strict' | 'Lax' | 'None' | undefined;
    let httpOnly = false;
    let secure = false;

    for (let i = 1; i < parts.length; i++) {
      const attr = parts[i].trim();
      const [key, val] = attr.split('=');
      const keyLower = key?.toLowerCase();
      if (keyLower === 'path' && val) {
        path = val;
      } else if (keyLower === 'samesite' && val) {
        if (val === 'Strict' || val === 'Lax' || val === 'None') {
          sameSite = val;
        }
      } else if (keyLower === 'httponly') {
        httpOnly = true;
      } else if (keyLower === 'secure') {
        secure = true;
      }
    }

    cookies.push({
      name,
      value,
      domain: '127.0.0.1',
      path,
      expires: -1,
      ...(sameSite && {sameSite}),
      httpOnly,
      secure,
    });
  }

  return {
    token,
    refreshToken: token,
    userId,
    email,
    cookies,
  };
}

/**
 * Seeds a user via Better Auth and returns JWT tokens for test authentication.
 * This function creates a user in Better Auth, signs them in, and returns
 * tokens that can be injected into localStorage for E2E tests.
 *
 * PROTECTED: Only callable when IS_TEST env var is set.
 */
export const seedUserAndGetTokens = testingAction({
  args: seedUserAndGetTokensArgsValidator,
  returns: seedUserAndGetTokensResultValidator,
  handler: seedUserAndGetTokensImpl,
});
