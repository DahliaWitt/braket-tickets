import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {api} from '../_generated/api';
import {buildFrontendCallbackUrl, resolveAuthBaseUrl} from '../lib/better_auth';
import {createAutoDrainConvexTest} from '../setup.testing';

// Mutation-context auth callbacks capture test email rows when IS_TEST=true.
const convexTest = createAutoDrainConvexTest();

const runActionMock = vi.hoisted(() => vi.fn());
const betterAuthMock = vi.hoisted(() => vi.fn((config: unknown) => config));
const createClientMock = vi.hoisted(() =>
  vi.fn(() => ({
    adapter: vi.fn(() => ({})),
    triggersApi: vi.fn(() => ({
      onCreate: vi.fn(),
      onUpdate: vi.fn(),
      onDelete: vi.fn(),
    })),
  })),
);
const convexPluginMock = vi.hoisted(() => vi.fn(() => ({id: 'convex-plugin'})));
const crossDomainPluginMock = vi.hoisted(() =>
  vi.fn(() => ({id: 'cross-domain-plugin'})),
);

vi.mock('@convex-dev/better-auth', () => ({
  createClient: createClientMock,
}));

vi.mock('@convex-dev/better-auth/plugins', () => ({
  convex: convexPluginMock,
  crossDomain: crossDomainPluginMock,
}));

vi.mock('better-auth', () => ({
  betterAuth: betterAuthMock,
}));

vi.mock('better-auth/api', () => ({
  createAuthMiddleware: (handler: unknown) => handler,
}));

vi.mock('better-auth/crypto', () => ({
  generateRandomString: () => 'mock-token',
}));

describe('auth password reset callback', () => {
  let originalIsTest: string | undefined;
  let originalResendApiKey: string | undefined;
  let originalSmtpUser: string | undefined;
  let originalSmtpPass: string | undefined;
  let originalAuthBaseUrl: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalIsTest = process.env.IS_TEST;
    originalResendApiKey = process.env.RESEND_API_KEY;
    originalSmtpUser = process.env.SMTP_USER;
    originalSmtpPass = process.env.SMTP_PASS;
    originalAuthBaseUrl = process.env.AUTH_BASE_URL;
    process.env.IS_TEST = 'true';
    process.env.AUTH_BASE_URL = 'http://127.0.0.1:3210';
  });

  afterEach(() => {
    if (originalIsTest === undefined) {
      delete process.env.IS_TEST;
    } else {
      process.env.IS_TEST = originalIsTest;
    }
    if (originalSmtpUser === undefined) {
      delete process.env.SMTP_USER;
    } else {
      process.env.SMTP_USER = originalSmtpUser;
    }
    if (originalSmtpPass === undefined) {
      delete process.env.SMTP_PASS;
    } else {
      process.env.SMTP_PASS = originalSmtpPass;
    }
    if (originalResendApiKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = originalResendApiKey;
    }
    if (originalAuthBaseUrl === undefined) {
      delete process.env.AUTH_BASE_URL;
    } else {
      process.env.AUTH_BASE_URL = originalAuthBaseUrl;
    }
  });

  it('awaits runAction in sendResetPassword before resolving', async () => {
    const {createAuth} =
      await vi.importActual<typeof import('../lib/better_auth')>(
        '../lib/better_auth',
      );

    let resolveRunAction: (() => void) | undefined;
    const runActionPromise = new Promise<void>((resolve) => {
      resolveRunAction = resolve;
    });
    runActionMock.mockReturnValueOnce(runActionPromise);

    const auth = createAuth({
      runAction: runActionMock,
    } as never) as {
      emailAndPassword?: {
        sendResetPassword?: (args: unknown) => Promise<void>;
      };
    };

    const sendResetPassword = auth.emailAndPassword?.sendResetPassword;
    expect(sendResetPassword).toBeTypeOf('function');

    if (!sendResetPassword) {
      throw new Error('Expected sendResetPassword to be defined');
    }

    let callbackResolved = false;
    const callbackPromise = sendResetPassword({
      user: {email: 'reset@example.com'},
      url: 'https://example.com/confirm/password-reset/token-123',
    }).then(() => {
      callbackResolved = true;
    });

    await Promise.resolve();

    expect(runActionMock).toHaveBeenCalledTimes(1);
    expect(callbackResolved).toBe(false);
    expect(runActionMock.mock.calls[0]?.[1]).toMatchObject({
      to: 'reset@example.com',
    });
    const runActionPayload = runActionMock.mock.calls[0]?.[1] as
      {subject?: string; html?: string} | undefined;
    expect(runActionPayload?.subject).toMatch(/reset/i);
    expect(runActionPayload?.html).toContain(
      'https://example.com/confirm/password-reset/token-123',
    );

    if (!resolveRunAction) {
      throw new Error('Expected resolveRunAction to be assigned');
    }
    resolveRunAction();

    await callbackPromise;
    expect(callbackResolved).toBe(true);
  });

  it('captures password reset email when auth is created with mutation context', async () => {
    const {createAuth} =
      await vi.importActual<typeof import('../lib/better_auth')>(
        '../lib/better_auth',
      );

    const t = convexTest();

    await t.run(async (ctx) => {
      const auth = createAuth(ctx as never) as {
        emailAndPassword?: {
          sendResetPassword?: (args: {
            user: {email: string};
            url: string;
          }) => Promise<void>;
        };
      };

      const sendResetPassword = auth.emailAndPassword?.sendResetPassword;
      expect(sendResetPassword).toBeTypeOf('function');
      if (!sendResetPassword) {
        throw new Error('Expected sendResetPassword to be defined');
      }

      await sendResetPassword({
        user: {email: 'reset@example.com'},
        url: 'https://example.com/confirm/password-reset/token-123',
      });
    });

    const payload = await readLatestTestEmail(t, 'reset@example.com');
    expect(payload).not.toBeNull();
    expect(payload?.to).toBe('reset@example.com');
    expect(payload?.subject).toMatch(/reset/i);
    expect(payload?.html).toContain(
      'https://example.com/confirm/password-reset/token-123',
    );
  });

  it('captures change email confirmation when auth is created with mutation context', async () => {
    const {createAuth} =
      await vi.importActual<typeof import('../lib/better_auth')>(
        '../lib/better_auth',
      );

    const t = convexTest();

    await t.run(async (ctx) => {
      const auth = createAuth(ctx as never) as {
        user?: {
          changeEmail?: {
            sendChangeEmailConfirmation?: (args: {
              user: {email: string};
              newEmail: string;
              url: string;
            }) => Promise<void>;
          };
        };
      };

      const sendChangeEmailConfirmation =
        auth.user?.changeEmail?.sendChangeEmailConfirmation;
      expect(sendChangeEmailConfirmation).toBeTypeOf('function');
      if (!sendChangeEmailConfirmation) {
        throw new Error('Expected sendChangeEmailConfirmation to be defined');
      }

      await sendChangeEmailConfirmation({
        user: {email: 'current@example.com'},
        newEmail: 'new@example.com',
        url: 'https://example.com/confirm/email-change/token-123',
      });
    });

    const payload = await readLatestTestEmail(t, 'current@example.com');
    expect(payload).not.toBeNull();
    expect(payload?.to).toBe('current@example.com');
    expect(payload?.subject?.length).toBeGreaterThan(0);
    expect(payload?.html).toContain('new@example.com');
  });

  it('rejects required delivery in mutation context when email is not configured', async () => {
    process.env.IS_TEST = 'false';
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;

    const {createAuth} =
      await vi.importActual<typeof import('../lib/better_auth')>(
        '../lib/better_auth',
      );

    const t = convexTest();

    await expect(
      t.run(async (ctx) => {
        const auth = createAuth(ctx as never) as {
          user?: {
            changeEmail?: {
              sendChangeEmailConfirmation?: (args: {
                user: {email: string};
                newEmail: string;
                url: string;
              }) => Promise<void>;
            };
          };
        };

        const sendChangeEmailConfirmation =
          auth.user?.changeEmail?.sendChangeEmailConfirmation;
        expect(sendChangeEmailConfirmation).toBeTypeOf('function');
        if (!sendChangeEmailConfirmation) {
          throw new Error('Expected sendChangeEmailConfirmation to be defined');
        }

        await sendChangeEmailConfirmation({
          user: {email: 'current@example.com'},
          newEmail: 'new@example.com',
          url: 'https://example.com/confirm/email-change/token-123',
        });
      }),
    ).rejects.toThrow(/not configured/i);

    const payload = await readLatestTestEmail(t, 'current@example.com');
    expect(payload).toBeNull();
  });
});

type CapturedEmail = {
  to?: string;
  subject?: string;
  html?: string;
};

async function readLatestTestEmail(
  t: ReturnType<typeof convexTest>,
  to: string,
): Promise<CapturedEmail | null> {
  const emails = await t.query(api.testing.email.getSentEmails, {to});
  const email = emails[0];
  return email
    ? {to: email.to, subject: email.subject, html: email.html}
    : null;
}

describe('resolveAuthBaseUrl', () => {
  let originalConvexSiteUrl: string | undefined;
  let originalAuthBaseUrl: string | undefined;

  beforeEach(() => {
    originalConvexSiteUrl = process.env.CONVEX_SITE_URL;
    originalAuthBaseUrl = process.env.AUTH_BASE_URL;
    delete process.env.CONVEX_SITE_URL;
    delete process.env.AUTH_BASE_URL;
  });

  afterEach(() => {
    if (originalConvexSiteUrl === undefined) {
      delete process.env.CONVEX_SITE_URL;
    } else {
      process.env.CONVEX_SITE_URL = originalConvexSiteUrl;
    }
    if (originalAuthBaseUrl === undefined) {
      delete process.env.AUTH_BASE_URL;
    } else {
      process.env.AUTH_BASE_URL = originalAuthBaseUrl;
    }
  });

  it('throws when neither CONVEX_SITE_URL nor AUTH_BASE_URL is set', () => {
    expect(() => resolveAuthBaseUrl()).toThrow(
      /AUTH_BASE_URL or CONVEX_SITE_URL must be set/,
    );
  });

  it('returns CONVEX_SITE_URL when set', () => {
    process.env.CONVEX_SITE_URL = 'https://test-deployment.convex.site';
    expect(resolveAuthBaseUrl()).toBe('https://test-deployment.convex.site');
  });

  it('falls back to AUTH_BASE_URL when CONVEX_SITE_URL is unset', () => {
    process.env.AUTH_BASE_URL = 'https://fallback-deployment.convex.site';
    expect(resolveAuthBaseUrl()).toBe(
      'https://fallback-deployment.convex.site',
    );
  });
});

describe('buildFrontendCallbackUrl', () => {
  const originalSiteUrl = process.env.SITE_URL;
  const originalAuthBaseUrl = process.env.AUTH_BASE_URL;
  const originalAllowLocalhost = process.env.ALLOW_LOCALHOST_CORS;

  beforeEach(() => {
    process.env.SITE_URL = 'https://app.example.com';
    process.env.AUTH_BASE_URL = 'http://127.0.0.1:3210';
    delete process.env.ALLOW_LOCALHOST_CORS;
  });

  afterEach(() => {
    if (originalSiteUrl === undefined) {
      delete process.env.SITE_URL;
    } else {
      process.env.SITE_URL = originalSiteUrl;
    }
    if (originalAuthBaseUrl === undefined) {
      delete process.env.AUTH_BASE_URL;
    } else {
      process.env.AUTH_BASE_URL = originalAuthBaseUrl;
    }
    if (originalAllowLocalhost === undefined) {
      delete process.env.ALLOW_LOCALHOST_CORS;
    } else {
      process.env.ALLOW_LOCALHOST_CORS = originalAllowLocalhost;
    }
  });

  it('accepts localhost frontend callback URLs when auth runs locally', () => {
    expect(
      buildFrontendCallbackUrl(
        'http://127.0.0.1:4201/confirm/social-link?provider=google',
        '/confirm/social-link',
      ),
    ).toBe('http://127.0.0.1:4201/confirm/social-link?provider=google');
  });

  it('falls back to SITE_URL for untrusted callback origins', () => {
    expect(
      buildFrontendCallbackUrl(
        'https://evil.example.com/confirm/social-link?provider=google',
        '/confirm/social-link',
      ),
    ).toBe('https://app.example.com/confirm/social-link');
  });

  it('preserves a same-origin relative callback path', () => {
    expect(
      buildFrontendCallbackUrl(
        '/confirm/social-link?provider=google',
        '/confirm/social-link',
      ),
    ).toBe('https://app.example.com/confirm/social-link?provider=google');
  });

  // Open-redirect allowlist bypass regression: the WHATWG URL parser treats `\`
  // as `/` for http/https, so a backslash-prefixed value resolves to an
  // external protocol-relative origin. Each of these must fall back, never
  // redirect off-origin.
  it.each([
    '/\\evil.com',
    '/\\/evil.com',
    '\\/\\/evil.com',
    '\\\\evil.com',
    '//evil.com',
    '/\\/\\evil.com',
    '  //evil.com', // leading whitespace is stripped by the URL parser
    '\t//evil.com', // leading control char is stripped by the URL parser
    'https://evil.com',
    'HTTPS://evil.com', // uppercase scheme
    'https://evil.com/confirm/social-link?provider=google',
    'https://app.example.com@evil.com', // userinfo trick
    'https://app.example.com.evil.com', // suffix-lookalike host
    'https://localhost.evil.com', // trusted-substring lookalike host
    'javascript:alert(document.domain)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://app.example.com/1234-5678', // same-origin but non-http(s)
  ])(
    'rejects open-redirect payload %j and falls back to SITE_URL',
    (payload) => {
      expect(buildFrontendCallbackUrl(payload, '/confirm/social-link')).toBe(
        'https://app.example.com/confirm/social-link',
      );
    },
  );

  it('keeps percent-encoded separators on the same origin path', () => {
    // %2F%2F is not re-decoded into an authority by the URL parser, so it stays
    // a same-origin path rather than becoming a protocol-relative redirect.
    expect(
      buildFrontendCallbackUrl('/%2F%2Fevil.com', '/confirm/social-link'),
    ).toBe('https://app.example.com/%2F%2Fevil.com');
  });
});

describe('haveIBeenPwned plugin registration', () => {
  const originalEnv = {...process.env};

  interface PluginShape {
    id?: string;
    options?: {
      paths?: string[];
      customPasswordCompromisedMessage?: string;
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_BASE_URL = 'http://127.0.0.1:3210';
    delete process.env.IS_TEST;
    delete process.env.AUTH_HIBP_DISABLED;
  });

  afterEach(() => {
    process.env = {...originalEnv};
  });

  async function buildPlugins(): Promise<PluginShape[]> {
    const {createAuth} =
      await vi.importActual<typeof import('../lib/better_auth')>(
        '../lib/better_auth',
      );
    const config = createAuth({runAction: runActionMock} as never) as {
      plugins?: PluginShape[];
    };
    return config.plugins ?? [];
  }

  it('registers the plugin outside test environments', async () => {
    const plugins = await buildPlugins();
    const hibp = plugins.find((p) => p.id === 'have-i-been-pwned');
    expect(hibp).toBeDefined();
  });

  it('checks only enabled HTTP routes, never server-only password flows', async () => {
    const {HIBP_CHECKED_PATHS} =
      await vi.importActual<typeof import('../lib/better_auth')>(
        '../lib/better_auth',
      );
    const plugins = await buildPlugins();
    const hibp = plugins.find((p) => p.id === 'have-i-been-pwned');

    // /change-password is disabled as an HTTP route and invoked by the V2
    // action through auth.api.changePassword. /set-password runs in mutation
    // context, where outbound fetch is prohibited.
    expect(hibp?.options?.paths).toEqual(HIBP_CHECKED_PATHS);
    expect(HIBP_CHECKED_PATHS).toEqual(['/sign-up/email', '/reset-password']);
    expect(hibp?.options?.paths).not.toContain('/change-password');
    expect(hibp?.options?.paths).not.toContain('/set-password');
  });

  it('uses the shared brand-voice compromised-password message', async () => {
    const {COMPROMISED_PASSWORD_MESSAGE} =
      await vi.importActual<typeof import('@shared/constants')>(
        '@shared/constants',
      );
    const plugins = await buildPlugins();
    const hibp = plugins.find((p) => p.id === 'have-i-been-pwned');
    expect(hibp?.options?.customPasswordCompromisedMessage).toBe(
      COMPROMISED_PASSWORD_MESSAGE,
    );
  });

  it('omits the plugin in E2E/test environments so tests never call HIBP', async () => {
    process.env.IS_TEST = 'true';
    const plugins = await buildPlugins();
    expect(plugins.some((p) => p.id === 'have-i-been-pwned')).toBe(false);
  });

  it('omits the plugin when the AUTH_HIBP_DISABLED kill switch is set', async () => {
    process.env.AUTH_HIBP_DISABLED = 'true';
    const plugins = await buildPlugins();
    expect(plugins.some((p) => p.id === 'have-i-been-pwned')).toBe(false);
  });
});

describe('password change route boundary', () => {
  const originalEnv = {...process.env};

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_BASE_URL = 'http://127.0.0.1:3210';
    process.env.IS_TEST = 'true';
  });

  afterEach(() => {
    process.env = {...originalEnv};
  });

  it('disables the Better Auth password-change HTTP route', async () => {
    const {createAuth} =
      await vi.importActual<typeof import('../lib/better_auth')>(
        '../lib/better_auth',
      );
    const config = createAuth({runAction: runActionMock} as never) as {
      disabledPaths?: string[];
    };

    expect(config.disabledPaths).toEqual(['/change-password']);
  });

  it('returns 404 for the disabled route without removing the server API', async () => {
    const [{betterAuth: realBetterAuth}, {memoryAdapter}] = await Promise.all([
      vi.importActual<typeof import('better-auth')>('better-auth'),
      vi.importActual<typeof import('better-auth/adapters/memory')>(
        'better-auth/adapters/memory',
      ),
    ]);
    const auth = realBetterAuth({
      baseURL: 'https://auth.example.com',
      secret: 'better-auth-test-secret-at-least-32-characters',
      database: memoryAdapter({}),
      emailAndPassword: {enabled: true},
      disabledPaths: ['/change-password'],
    });

    const response = await auth.handler(
      new Request('https://auth.example.com/api/auth/change-password', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          currentPassword: 'old-password-123',
          newPassword: 'new-password-456',
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not Found');
    expect(auth.api.changePassword).toBeTypeOf('function');
  });
});
