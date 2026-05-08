import {test as setup, expect} from '@playwright/test';
import {ConvexTestingHelper} from 'convex-helpers/testing';
import path from 'path';
import {api} from '@convex/_generated/api';
import {pollUntil, retryWithDelays} from './helpers/async-control';
import {
  SHARED_ADMIN_ACCOUNT,
  SHARED_USER_ACCOUNT,
} from './test-utils/auth-accounts';

const authFileUser = path.join(__dirname, '../playwright/.auth/user.json');
const authFileAdmin = path.join(__dirname, '../playwright/.auth/admin.json');

// Local backend URLs (parameterized for E2E port isolation)
// Port 3210: Convex functions API (.convex.cloud)
// Port 3211: HTTP routes including Better Auth (.convex.site)
const AUTH_URL = process.env.CONVEX_SITE_URL || 'http://127.0.0.1:3211';
const CONVEX_URL = process.env.CONVEX_URL || 'http://127.0.0.1:3210';

// Origin header for CORS (must match SITE_URL set by backendHarness.js)
const _SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:4201';

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url);
}

function assertLocalConvexTargetsForE2E(): void {
  if (!isLocalUrl(CONVEX_URL)) {
    throw new Error(
      `[E2E SAFETY] Refusing to run against non-local CONVEX_URL: ${CONVEX_URL}`,
    );
  }
  if (!isLocalUrl(AUTH_URL)) {
    throw new Error(
      `[E2E SAFETY] Refusing to run against non-local CONVEX_SITE_URL: ${AUTH_URL}`,
    );
  }
}

interface SessionResponse {
  session: {
    token: string;
    userId: string;
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    id: string;
  };
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

interface AuthResult {
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    sameSite?: 'Strict' | 'Lax' | 'None';
    httpOnly?: boolean;
  }[];
  sessionData: SessionResponse | null;
}

function summarizeAuthResponse(value: unknown): string {
  if (!value || typeof value !== 'object') return typeof value;

  const response = value as Record<string, unknown>;
  const user = response['user'];
  const userSummary =
    user && typeof user === 'object'
      ? ` userKeys=${Object.keys(user).sort().join(',')}`
      : '';

  return `keys=${Object.keys(response).sort().join(',')}${userSummary}`;
}

async function readSanitizedError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return '<empty>';

  return text
    .replace(
      /([?&](?:token|ott|code|state|session|secret)=)[^&\s"]+/gi,
      '$1[redacted]',
    )
    .replace(
      /("(?:token|ott|code|state|session|secret|password)"\s*:\s*")[^"]+(")/gi,
      '$1[redacted]$2',
    )
    .slice(0, 500);
}

/**
 * Creates a user via Better Auth HTTP API and returns authentication cookies and session.
 * If user already exists, signs in instead.
 */
async function signUpWithBetterAuth(
  email: string,
  password: string,
  name: string,
  verifyUser?: () => Promise<void>,
): Promise<AuthResult> {
  const signInWithRetry = async (): Promise<Response> => {
    const retryDelaysMs = [0, 300, 300, 300, 300] as const;
    let lastError: string | null = null;

    try {
      return await retryWithDelays({
        delaysMs: retryDelaysMs,
        run: async () => {
          const signInResponse = await fetch(
            `${AUTH_URL}/api/auth/sign-in/email`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Origin: AUTH_URL, // Use auth URL as origin
              },
              body: JSON.stringify({
                email,
                password,
              }),
            },
          );

          if (signInResponse.ok) {
            return signInResponse;
          }

          lastError = await readSanitizedError(signInResponse);
          throw new Error(
            `Sign in failed after user exists: ${signInResponse.status} ${lastError}`,
          );
        },
        shouldRetry: (_error, attemptIndex) =>
          attemptIndex < retryDelaysMs.length - 1,
      });
    } catch {
      throw new Error(
        `Sign in failed after user exists: ${lastError ?? 'Unknown error'}`,
      );
    }
  };

  // Use the AUTH_URL as origin to avoid triggering cross-domain flow
  // This simulates a same-origin request
  let response = await fetch(`${AUTH_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: AUTH_URL, // Use auth URL as origin to avoid cross-domain
    },
    body: JSON.stringify({
      email,
      password,
      name,
    }),
  });

  // If user already exists (from previous test run), sign in instead
  if (!response.ok) {
    const errorText = await readSanitizedError(response);
    const isAlreadyExistingUserError =
      response.status === 422 &&
      (errorText.includes('USER_ALREADY_EXISTS') ||
        errorText.includes('FAILED_TO_CREATE_USER') ||
        errorText.toLowerCase().includes('failed to create user'));

    if (isAlreadyExistingUserError) {
      console.log(`User ${email} already exists, signing in instead...`);

      // Verify user before sign-in (required when email verification is enabled)
      if (verifyUser) {
        console.log(`Verifying user ${email} before sign-in...`);
        await verifyUser();
      }

      response = await signInWithRetry();
    } else {
      throw new Error(`Sign up failed: ${response.status} ${errorText}`);
    }
  }

  // Get response body
  const responseBody = await response.json();

  // Extract cookies from response headers
  let setCookieHeaders: string[] = [];

  // With crossDomain plugin disabled for E2E tests (IS_TEST=true),
  // the response should contain session and user directly with cookies set
  let sessionData: SessionResponse | null;

  if (responseBody.session && responseBody.user) {
    // Standard session response (when crossDomain is disabled)
    console.log('Got standard session response (crossDomain disabled)');
    sessionData = responseBody;
  } else if (
    responseBody.token &&
    responseBody.user &&
    responseBody.redirect !== true
  ) {
    // Non-redirect token response - this is the session token, not an OTT
    // The token value matches the session_token cookie (redirect is false or undefined)
    console.log(
      `Got token response (session token in body, redirect: ${String(responseBody.redirect)})`,
    );

    // Construct session data from the response
    // The session token is in the cookie, we just need user data for localStorage
    sessionData = {
      session: {
        token: responseBody.token,
        userId: responseBody.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: responseBody.user.createdAt
          ? new Date(responseBody.user.createdAt).toISOString()
          : new Date().toISOString(),
        updatedAt: responseBody.user.updatedAt
          ? new Date(responseBody.user.updatedAt).toISOString()
          : new Date().toISOString(),
        id: `session-${Date.now()}`,
      },
      user: responseBody.user,
    };
  } else if (
    responseBody.token &&
    responseBody.user &&
    responseBody.redirect === true
  ) {
    // Cross-domain OTT flow (redirect=true indicates OTT that needs verification)
    console.warn(
      'Got OTT response with redirect=true - crossDomain plugin is enabled',
    );
    console.warn('Verify that IS_TEST=true is set in Convex environment');

    // Try to verify the OTT using the correct endpoint
    const verifyResponse = await fetch(
      `${AUTH_URL}/api/auth/cross-domain/one-time-token/verify`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: AUTH_URL,
        },
        body: JSON.stringify({token: responseBody.token}),
      },
    );

    if (verifyResponse.ok) {
      const verifyData = await verifyResponse.json();
      console.log(
        `OTT verification succeeded (${summarizeAuthResponse(verifyData)})`,
      );
      sessionData = verifyData;

      // Also get cookies from verify response
      if (typeof verifyResponse.headers.getSetCookie === 'function') {
        setCookieHeaders.push(...verifyResponse.headers.getSetCookie());
      }
    } else {
      const errorText = await readSanitizedError(verifyResponse);
      console.error(
        'OTT verification failed:',
        verifyResponse.status,
        errorText,
      );
      throw new Error(
        `OTT verification failed - ensure IS_TEST=true is set: ${errorText}`,
      );
    }
  } else if (responseBody.token === null && responseBody.user) {
    // User created but email verification required before sign-in
    // This happens when sendEmailVerificationOnSignUp is enabled
    console.log(
      'Got user creation response with token=null (email verification required)',
    );

    // Verify the user's email if callback is provided
    if (verifyUser) {
      console.log(`Verifying email for ${email} before sign-in...`);
      await verifyUser();
    }

    // Now sign in to get the session with cookies
    console.log(`Signing in ${email} after email verification...`);
    const signInResponse = await fetch(`${AUTH_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: AUTH_URL,
      },
      body: JSON.stringify({email, password}),
    });

    if (!signInResponse.ok) {
      const signInError = await readSanitizedError(signInResponse);
      throw new Error(
        `Sign in failed after email verification: ${signInResponse.status} ${signInError}`,
      );
    }

    const signInBody = await signInResponse.json();

    // Extract cookies from sign-in response
    if (typeof signInResponse.headers.getSetCookie === 'function') {
      setCookieHeaders = signInResponse.headers.getSetCookie();
    }

    // Check for session data in sign-in response
    if (signInBody.session && signInBody.user) {
      sessionData = signInBody;
    } else if (signInBody.token && signInBody.user) {
      // Token response - construct session data
      sessionData = {
        session: {
          token: signInBody.token,
          userId: signInBody.user.id,
          expiresAt: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          createdAt: signInBody.user.createdAt
            ? new Date(signInBody.user.createdAt).toISOString()
            : new Date().toISOString(),
          updatedAt: signInBody.user.updatedAt
            ? new Date(signInBody.user.updatedAt).toISOString()
            : new Date().toISOString(),
          id: `session-${Date.now()}`,
        },
        user: signInBody.user,
      };
    } else {
      throw new Error('Sign-in after verification did not return session data');
    }
  } else {
    throw new Error(
      `Unexpected auth response format - no session or token found (${summarizeAuthResponse(responseBody)})`,
    );
  }
  if (typeof response.headers.getSetCookie === 'function') {
    setCookieHeaders =
      setCookieHeaders.length > 0
        ? setCookieHeaders
        : response.headers.getSetCookie();
  }

  if (setCookieHeaders.length === 0) {
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        const parts = value.split(/,(?=\s*(?:__Secure-)?better-auth\.)/);
        setCookieHeaders.push(...parts);
      }
    });
  }

  if (setCookieHeaders.length === 0) {
    const singleHeader = response.headers.get('set-cookie');
    if (singleHeader) {
      const parts = singleHeader.split(/,(?=\s*(?:__Secure-)?better-auth\.)/);
      setCookieHeaders.push(...parts);
    } else {
      throw new Error('No session cookies returned from sign up');
    }
  }

  console.log(
    `Global Setup: Raw Set-Cookie headers count: ${setCookieHeaders.length}`,
  );

  // Parse cookies from Set-Cookie headers
  const cookies = setCookieHeaders.map((setCookie) => {
    const [nameValue, ...attributes] = setCookie.split(';');
    const [cookieName, ...valueParts] = nameValue.trim().split('=');
    const value = valueParts.join('='); // Handle values with = in them

    let domain = '127.0.0.1';
    let cookiePath = '/';
    let sameSite: 'Strict' | 'Lax' | 'None' | undefined = undefined;
    let httpOnly = false;

    for (const attr of attributes) {
      const [key, val] = attr.trim().split('=');
      const keyLower = key.toLowerCase();
      if (keyLower === 'domain' && val) {
        domain = val.replace(/^\./, '');
      } else if (keyLower === 'path' && val) {
        cookiePath = val;
      } else if (keyLower === 'samesite' && val) {
        sameSite = val as 'Strict' | 'Lax' | 'None';
      } else if (keyLower === 'httponly') {
        httpOnly = true;
      }
    }

    return {
      name: cookieName.trim(),
      value: value.trim(),
      domain,
      path: cookiePath,
      ...(sameSite && {sameSite}),
      ...(httpOnly && {httpOnly}),
    };
  });

  return {
    cookies,
    sessionData,
  };
}

/**
 * Syncs a Better Auth user to the application's users table.
 */
async function syncUserToApp(
  t: ConvexTestingHelper,
  email: string,
  name: string,
  isRootAdmin = false,
): Promise<void> {
  console.log(`syncUserToApp: Creating user ${email} in app database...`);
  try {
    const userId = await t.mutation(api.testing.users.createUserDirectly, {
      email,
      name,
      isRootAdmin,
    });
    console.log(`syncUserToApp: User created with ID: ${userId}`);
  } catch (err) {
    console.error(`syncUserToApp: Error creating user:`, err);
    throw err;
  }
}

/**
 * Gets session data from Better Auth API using the cookies.
 */
async function getSessionFromApi(
  cookies: AuthResult['cookies'],
): Promise<SessionResponse | null> {
  // Build cookie header from cookies
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  const response = await fetch(`${AUTH_URL}/api/auth/get-session`, {
    method: 'GET',
    headers: {
      Origin: AUTH_URL, // Use auth URL as origin
      Cookie: cookieHeader,
    },
  });

  if (!response.ok) {
    console.log('getSession failed:', response.status);
    return null;
  }

  const data = await response.json();
  console.log(`getSession succeeded (${summarizeAuthResponse(data)})`);
  return data;
}

/**
 * Sets up browser authentication state by injecting cookies and localStorage values.
 */
async function setupBrowserAuth(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
  authResult: AuthResult,
): Promise<void> {
  // First navigate to the app to initialize the origin
  await page.goto('/', {waitUntil: 'domcontentloaded'});
  await expect(page.locator('body')).toBeVisible();

  // Clear any existing auth state
  await context.clearCookies();
  await page.evaluate(() => localStorage.clear());

  // Add cookies to browser context
  const cookiesToAdd = authResult.cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    sameSite: c.sameSite || 'Lax',
    httpOnly: c.httpOnly || false,
    secure: false, // Local testing uses HTTP
  }));

  console.log('Adding cookies:', cookiesToAdd.map((c) => c.name).join(', '));
  await context.addCookies(cookiesToAdd);

  // Get proper session data from the API using cookies
  const sessionData = await getSessionFromApi(authResult.cookies);
  console.log('Session data from API:', sessionData ? 'found' : 'null');

  if (sessionData) {
    // Build the cookie storage object that crossDomainClient expects
    const cookieStorage: Record<string, {value: string; expires: string}> = {};
    for (const cookie of authResult.cookies) {
      const expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      cookieStorage[cookie.name] = {
        value: cookie.value,
        expires: expiryDate.toISOString(),
      };
    }

    await page.evaluate(
      ({sd, cs}) => {
        localStorage.setItem('braket-tickets_session_data', JSON.stringify(sd));
        localStorage.setItem('braket-tickets_cookie', JSON.stringify(cs));
      },
      {sd: sessionData, cs: cookieStorage},
    );

    console.log('Set localStorage values for crossDomainClient');
  } else {
    console.log('WARNING: No session data available, auth may not work');
  }

  // Note: We don't verify by navigating to /dashboard here because Angular's
  // Convex query initialization happens before AuthService.initSession() completes.
  // The storage state we've set will be picked up when the actual tests run.
  console.log('Auth setup complete - storage state saved');
}

setup('global setup', async ({page, context, browser}) => {
  assertLocalConvexTargetsForE2E();
  console.log(`Global Setup: Using local Convex API URL ${CONVEX_URL}`);
  console.log(`Global Setup: Using local Convex Site URL ${AUTH_URL}`);

  const t = new ConvexTestingHelper({
    backendUrl: CONVEX_URL,
  });

  // Poll the Convex backend until it responds, instead of sleeping a fixed 2s.
  // The backend harness waits for env vars to reload, but WebSocket connections
  // may need additional time to stabilize depending on machine load.
  console.log('Global Setup: Polling Convex backend for readiness...');
  const healthTimeout = 15000;
  const healthPollInterval = 500;
  const healthStart = Date.now();
  const backendReady = await pollUntil({
    timeoutMs: healthTimeout,
    intervalMs: healthPollInterval,
    getValue: async () => {
      try {
        await t.query(api.testing.users.getUserByEmail, {
          email: 'healthcheck-nonexistent@test.invalid',
        });
        return true;
      } catch {
        return null;
      }
    },
  });

  if (!backendReady) {
    throw new Error(
      `Convex backend did not respond within ${healthTimeout}ms. Check that the local backend is running.`,
    );
  }
  console.log(
    `Global Setup: Backend ready after ${Date.now() - healthStart}ms`,
  );

  // Debug: Check if user already exists in app database
  console.log('Global Setup: Checking if user exists in app database...');
  const existingUser = await t.query(api.testing.users.getUserByEmail, {
    email: SHARED_USER_ACCOUNT.email,
  });
  console.log('Existing user in app DB:', existingUser ? 'YES' : 'NO');

  /**
   * @readonly Shared test fixture accounts. These are created once in global setup
   * and reused across all tests via authedPage/adminPage fixtures. Tests MUST NOT
   * mutate these accounts (change email, name, password, community roles). Tests
   * needing mutable user state should create their own user via convexHelper.
   */

  // --- Parallel User Creation ---
  console.log(
    'Global Setup: Creating both users via Better Auth in parallel...',
  );

  // Create both users in parallel
  const [userAuth, adminAuth] = await Promise.all([
    signUpWithBetterAuth(
      SHARED_USER_ACCOUNT.email,
      SHARED_USER_ACCOUNT.password,
      SHARED_USER_ACCOUNT.name,
      async () => {
        // Verify user email (called when user already exists from previous test run)
        await t.mutation(api.testing.users.verifyAccountAndUser, {
          email: SHARED_USER_ACCOUNT.email,
        });
      },
    ),
    signUpWithBetterAuth(
      SHARED_ADMIN_ACCOUNT.email,
      SHARED_ADMIN_ACCOUNT.password,
      SHARED_ADMIN_ACCOUNT.name,
      async () => {
        // Verify admin email (called when user already exists from previous test run)
        await t.mutation(api.testing.users.verifyAccountAndUser, {
          email: SHARED_ADMIN_ACCOUNT.email,
        });
      },
    ),
  ]);

  console.log(
    'Global Setup: Received cookies for user:',
    userAuth.cookies.map((c) => c.name).join(', '),
  );
  console.log(
    'Global Setup: Received cookies for admin:',
    adminAuth.cookies.map((c) => c.name).join(', '),
  );

  // Verify both users in parallel
  console.log('Global Setup: Verifying both user emails...');
  await Promise.all([
    t.mutation(api.testing.users.verifyAccountAndUser, {
      email: SHARED_USER_ACCOUNT.email,
    }),
    t.mutation(api.testing.users.verifyAccountAndUser, {
      email: SHARED_ADMIN_ACCOUNT.email,
    }),
  ]);

  // Sync both users to app database in parallel
  console.log('Global Setup: Syncing both users to app database...');
  await Promise.all([
    syncUserToApp(
      t,
      SHARED_USER_ACCOUNT.email,
      SHARED_USER_ACCOUNT.name,
      false,
    ),
    syncUserToApp(
      t,
      SHARED_ADMIN_ACCOUNT.email,
      SHARED_ADMIN_ACCOUNT.name,
      true,
    ),
  ]);

  // --- Set up browser auth for both users in parallel (separate contexts) ---
  console.log('Global Setup: Setting up browser auth for both users in parallel...');
  await Promise.all([
    (async () => {
      await setupBrowserAuth(page, context, userAuth);
      await context.storageState({path: authFileUser});
      console.log('Global Setup: Standard user saved to ' + authFileUser);
    })(),
    (async () => {
      const adminCtx = await browser.newContext();
      try {
        const adminPage = await adminCtx.newPage();
        await setupBrowserAuth(adminPage, adminCtx, adminAuth);
        await adminCtx.storageState({path: authFileAdmin});
        console.log('Global Setup: Admin user saved to ' + authFileAdmin);
      } finally {
        await adminCtx.close();
      }
    })(),
  ]);

  await t.close();
});
