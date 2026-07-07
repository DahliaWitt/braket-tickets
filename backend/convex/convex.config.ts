import {defineApp} from 'convex/server';
import {v} from 'convex/values';
import betterAuth from '@convex-dev/better-auth/convex.config';
import rateLimiter from '@convex-dev/rate-limiter/convex.config';
import resend from '@convex-dev/resend/convex.config.js';
import workpool from '@convex-dev/workpool/convex.config';
import migrations from '@convex-dev/migrations/convex.config';
import authz from '@djpanda/convex-authz/convex.config';

// Deploy-time env var validation (convex 1.39+). Required vars must be set on
// a deployment BEFORE `convex deploy` runs against it:
// - local harness: scripts/lib/ConvexBackend.ts sets env vars before deploy
// - CI: sync:env:dev / sync:env:prod run before `convex deploy`
// Everything feature-gated stays optional — runtime code owns the fallback
// chains (e.g. EMAIL_FROM -> SMTP_FROM -> SMTP_USER). Convex built-ins
// (CONVEX_SITE_URL, CONVEX_CLOUD_URL) must not be declared here.
// Reads stay on process.env until the typed `env` export leaves beta.
const app: ReturnType<typeof defineApp> = defineApp({
  env: {
    // Hard-required: runtime already throws without these; the app cannot work.
    SITE_URL: v.string(),
    TOKEN_DIGEST_SECRET: v.string(),

    // Auth (feature-gated: social providers optional).
    AUTH_BASE_URL: v.optional(v.string()),
    BETTER_AUTH_SECRET: v.optional(v.string()),
    GOOGLE_CLIENT_ID: v.optional(v.string()),
    GOOGLE_CLIENT_SECRET: v.optional(v.string()),
    DISCORD_CLIENT_ID: v.optional(v.string()),
    DISCORD_CLIENT_SECRET: v.optional(v.string()),
    JWT_PRIVATE_KEY: v.optional(v.string()),
    JWKS: v.optional(v.string()),

    // Payments (Stripe actions throw STRIPE_NOT_CONFIGURED when unset).
    STRIPE_SECRET_KEY: v.optional(v.string()),
    STRIPE_WEBHOOK_SECRET: v.optional(v.string()),
    STRIPE_WEBHOOK_SECRET_CONNECT: v.optional(v.string()),
    STRIPE_WEBHOOK_SECRET_V2_EVENTS: v.optional(v.string()),

    // Email delivery (mode-dependent: Resend or SMTP).
    RESEND_API_KEY: v.optional(v.string()),
    RESEND_TEST_MODE: v.optional(v.string()),
    RESEND_WEBHOOK_SECRET: v.optional(v.string()),
    EMAIL_FROM: v.optional(v.string()),
    EMAIL_REPLY_TO: v.optional(v.string()),
    SMTP_HOST: v.optional(v.string()),
    SMTP_PORT: v.optional(v.string()),
    SMTP_USER: v.optional(v.string()),
    SMTP_PASS: v.optional(v.string()),
    SMTP_FROM: v.optional(v.string()),
    SMTP_REPLY_TO: v.optional(v.string()),

    // Test / seed gating (lib/environment.ts enforces the pairing rules).
    // These booleans are intentionally v.string(), NOT a
    // v.union(v.literal('true'), v.literal('false')): lib/environment.ts reads
    // them as `=== 'true'`, so any other value already degrades safely to
    // "false". A literal union would instead turn an unexpected legacy value
    // (e.g. '1' or '') on a deployment we can't inspect into a hard deploy
    // failure — env/deploy changes are high-risk, so we validate presence, not
    // the exact boolean spelling.
    ALLOW_LOCALHOST_CORS: v.optional(v.string()),
    IS_TEST: v.optional(v.string()),
    DEV_SEED: v.optional(v.string()),
    DEV_SEED_TOKEN: v.optional(v.string()),
    DEV_SEED_EXPIRES_AT: v.optional(v.string()),
    E2E_CONVEX_SITE_URL: v.optional(v.string()),
  },
});
app.use(betterAuth);
app.use(rateLimiter);
app.use(resend);
app.use(workpool, {name: 'payoutPool'});
app.use(workpool, {name: 'stripePool'});
app.use(migrations);
app.use(authz);

export default app;
