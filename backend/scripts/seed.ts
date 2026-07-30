/**
 * seed.ts — Unified seed entry point.
 *
 * Replaces scripts/seed-demo.js, scripts/seed-local.js, and
 * scripts/seed-sandbox-fixture.js.
 *
 * Usage:
 *   tsx scripts/seed.ts [--target local|dev] [--fresh] [--fixture] [--clear-only] [--url <url>]
 *
 *   --target local   Seed the local backend (default, enforces local URL)
 *   --target dev     Seed the remote dev deployment
 *   --fresh          Clear all data before seeding
 *   --fixture        Run the Stripe sandbox fixture instead of the demo seed
 *   --clear-only     Clear seed data without reseeding
 *   --url <url>      Override the Convex URL
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {execFileSync} from 'child_process';
import Stripe from 'stripe';
import {
  ensureDopplerEnv,
  ADMIN_KEY,
  CONVEX_CLI,
  LOCAL_DIR,
  PROJECT_ROOT,
  isLocalUrl,
} from '../../scripts/lib/shared.ts';
import {STRIPE_V2_ACCOUNT_CONFIG} from '../convex/stripe/_impl/constants.ts';
import {
  mapV2AccountStatus,
  type ConnectedAccountStatus,
} from '../convex/stripe/_impl/accounts.ts';
import type {Id} from '../convex/_generated/dataModel';
import {
  convexEnvTargetArgs,
  createSeedEnvSession,
  resolveSeedEnvTarget,
  type DevSeedEnvVar,
  type SeedCleanupTarget,
  type SeedEnvTarget,
} from './seed-session.ts';
import {
  createSeedClient,
  getSeedErrorText,
  seedCheckExists,
  seedClearAll,
  seedClearBetterAuthUsers,
  seedDemoData,
  seedGenerateUploadUrl,
  seedSandboxPurchaseFixture,
  seedUserAndGetTokens,
  type SeedClient,
  type SeedLogoIds,
  type SeedPosterIds,
  type SeedSandboxPurchaseFixtureArgs,
  type SeedUserId,
} from './seed-client.ts';

ensureDopplerEnv();

// ── Constants ──────────────────────────────────────────────────────────────────

const PROD_DEPLOYMENT_SLUG = 'modest-impala';
const STAGING_DEPLOYMENT_SLUG = 'bright-swordfish-194';
const LOCAL_ADMIN_KEY_FILE = path.join(LOCAL_DIR, '.admin-key');
const SEED_SESSION_TTL_MS = 15 * 60 * 1000;

const USERS = [
  {key: 'cooperId', email: 'cooper@example.com', name: 'Dale Cooper'},
  {key: 'kimId', email: 'kim@example.com', name: 'Kim Wexler'},
  {key: 'nomiId', email: 'nomi@example.com', name: 'Nomi Marks'},
  {key: 'barneyId', email: 'barney@example.com', name: 'Barney Calhoun'},
  {key: 'charlieId', email: 'charlie@example.com', name: 'Charlie Kelly'},
  {key: 'tobiasId', email: 'tobias@example.com', name: 'Tobias Funke'},
  {key: 'cherylId', email: 'cheryl@example.com', name: 'Cheryl Tunt'},
] as const;
type UserKey = (typeof USERS)[number]['key'];

const SEED_ASSETS = path.join(import.meta.dirname, 'seed-assets');

// LINT.IfChange
const POSTER_FILES = [
  {key: 'concreteWax', file: 'concrete-wax.jpg'},
  {key: 'lowFrequency', file: 'low-frequency.jpg'},
  {key: 'nightMarket', file: 'night-market.jpg'},
  {key: 'springFundraiser', file: 'spring-fundraiser.jpg'},
  {key: 'rooftopListening', file: 'rooftop-listening.jpg'},
] as const;
// LINT.ThenChange("../convex/testing/demo.ts")
type PosterKey = (typeof POSTER_FILES)[number]['key'];

// LINT.IfChange
const LOGO_FILES = [
  {key: 'lot45', file: 'logo-lot45.jpg'},
  {key: 'sisterCity', file: 'logo-sister-city.jpg'},
  {key: 'midnightSound', file: 'logo-midnight-sound.jpg'},
] as const;
// LINT.ThenChange("../convex/testing/demo.ts")
type LogoKey = (typeof LOGO_FILES)[number]['key'];

const USER_ROLES: Record<string, string> = {
  cooperId: 'root admin',
  kimId: 'community admin (Anfangszeit)',
  nomiId: 'community admin (Sister City) + scanner',
  barneyId: 'scanner (Anfangszeit)',
  charlieId: 'vetted buyer',
  tobiasId: 'new user (unverified)',
  cherylId: 'community admin (Deep End Collective, draft)',
};

// ── Argument parsing ───────────────────────────────────────────────────────────

function getArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

const args = process.argv.slice(2);
const isFresh = args.includes('--fresh');
const isFixture = args.includes('--fixture');
const isClearOnly = args.includes('--clear-only');
const targetArg = getArgValue('--target') ?? 'local';
const urlOverride = getArgValue('--url');

if (isClearOnly && isFixture) {
  console.error('Error: --clear-only and --fixture cannot be used together.');
  process.exit(1);
}

if (targetArg !== 'local' && targetArg !== 'dev') {
  console.error(`Error: --target must be "local" or "dev", got "${targetArg}"`);
  process.exit(1);
}

const isLocal = targetArg === 'local';
const isDev = targetArg === 'dev';

// ── URL resolution ─────────────────────────────────────────────────────────────

function readLocalConvexUrl(): string | null {
  const localUrlFile = path.join(LOCAL_DIR, '.local-convex-url');
  if (fs.existsSync(localUrlFile)) {
    const value = fs.readFileSync(localUrlFile, 'utf-8').trim();
    if (value) return value;
  }
  return null;
}

function readLocalE2EConvexUrl(): string | null {
  const e2eUrlFile = path.join(LOCAL_DIR, '.e2e-convex-url');
  if (fs.existsSync(e2eUrlFile)) {
    const value = fs.readFileSync(e2eUrlFile, 'utf-8').trim();
    if (value) return value;
  }
  return null;
}

async function resolveConvexUrl(): Promise<string> {
  if (urlOverride) return urlOverride;

  if (isLocal) {
    // For local target: check env var, then file-based URLs, then default
    const envUrl = process.env['CONVEX_URL'];
    if (envUrl) return envUrl;
    const localUrl = readLocalConvexUrl();
    if (localUrl) {
      console.log(`Using local Convex URL from .convex-local: ${localUrl}`);
      return localUrl;
    }
    // Only use the E2E URL if that backend is actually reachable —
    // a stale .e2e-convex-url from a previous run must not hijack
    // seed runs aimed at the default dev server on port 3210.
    const e2eUrl = readLocalE2EConvexUrl();
    if (e2eUrl) {
      try {
        const res = await fetch(e2eUrl, {signal: AbortSignal.timeout(1000)});
        if (res.ok) {
          console.log(`Using E2E Convex URL from .convex-local: ${e2eUrl}`);
          return e2eUrl;
        }
      } catch {
        // E2E backend not running — fall through to default
      }
    }
    return 'http://127.0.0.1:3210';
  }

  // For dev target: require explicit CONVEX_URL or --url
  const envUrl = process.env['CONVEX_URL'];
  if (envUrl) return envUrl;

  console.error('Error: No Convex deployment URL found.');
  console.error('');
  console.error('Fix one of:');
  console.error(
    '  - Pass an explicit URL: tsx scripts/seed.ts --target dev --url https://your-deployment.convex.cloud',
  );
  console.error('  - Set CONVEX_URL in your environment.');
  console.error('');
  console.error(
    'Note: --target dev does not auto-fallback to the local E2E URL.',
  );
  process.exit(1);
}

// ── Admin key resolution ───────────────────────────────────────────────────────

function resolveLocalAdminKey(): string | undefined {
  const envKey =
    process.env['CONVEX_ADMIN_KEY'] ??
    process.env['CONVEX_LOCAL_ADMIN_KEY'] ??
    process.env['ADMIN_KEY'];
  if (envKey && envKey.trim()) return envKey.trim();

  try {
    const fileKey = fs.readFileSync(LOCAL_ADMIN_KEY_FILE, 'utf-8').trim();
    return fileKey || undefined;
  } catch {
    return undefined;
  }
}

// ── convexEnvSet / convexEnvRemove ─────────────────────────────────────────────
// Local backends need --admin-key and --url. Remote seed sessions rely on the
// deployment-scoped CONVEX_DEPLOY_KEY injected by Doppler and must not pass a
// conflicting --deployment flag. resolveSeedEnvTarget validates that the key
// and URL identify the same allowlisted dev deployment before these helpers
// can receive a remote target.

function convexEnvSet(
  name: string,
  value: string,
  target: SeedEnvTarget,
): void {
  execFileSync(
    CONVEX_CLI,
    ['env', 'set', name, ...convexEnvTargetArgs(target)],
    {
      cwd: PROJECT_ROOT,
      input: value,
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout: 30000,
    },
  );
}

function convexEnvRemove(name: string, target: SeedEnvTarget): boolean {
  try {
    execFileSync(
      CONVEX_CLI,
      ['env', 'remove', name, ...convexEnvTargetArgs(target)],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return true;
  } catch {
    // Best-effort cleanup — don't fail if the var is already gone
    return false;
  }
}

// ── Image upload helpers ───────────────────────────────────────────────────────

interface UploadUrlResult {
  storageId: Id<'_storage'>;
}

async function uploadImage<K extends PosterKey | LogoKey>(
  spec: {key: K; file: string},
  client: SeedClient,
  seedToken: string,
): Promise<[K, Id<'_storage'>]> {
  const filePath = path.join(SEED_ASSETS, spec.file);
  const data = fs.readFileSync(filePath);
  const uploadUrl = await seedGenerateUploadUrl(client, seedToken);

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {'Content-Type': 'image/jpeg'},
    body: data,
  });

  if (!res.ok) {
    throw new Error(`Image upload failed for ${spec.key}: ${res.status}`);
  }

  const json = (await res.json()) as UploadUrlResult;
  console.log(`  ${spec.key}: ${json.storageId}`);
  return [spec.key, json.storageId];
}

function getUploadedId<K extends string>(
  uploaded: ReadonlyMap<K, Id<'_storage'>>,
  key: K,
): Id<'_storage'> {
  const storageId = uploaded.get(key);
  if (storageId === undefined) {
    throw new Error(`Seed upload ${key} did not complete.`);
  }
  return storageId;
}

async function uploadPosters(opts: {
  client: SeedClient;
  seedToken: string;
}): Promise<SeedPosterIds> {
  console.log('Uploading event posters...');
  const entries = await Promise.all(
    POSTER_FILES.map((spec) => uploadImage(spec, opts.client, opts.seedToken)),
  );
  const uploaded = new Map<PosterKey, Id<'_storage'>>(entries);
  return {
    concreteWax: getUploadedId(uploaded, 'concreteWax'),
    lowFrequency: getUploadedId(uploaded, 'lowFrequency'),
    nightMarket: getUploadedId(uploaded, 'nightMarket'),
    springFundraiser: getUploadedId(uploaded, 'springFundraiser'),
    rooftopListening: getUploadedId(uploaded, 'rooftopListening'),
  };
}

async function uploadLogos(opts: {
  client: SeedClient;
  seedToken: string;
}): Promise<SeedLogoIds> {
  console.log('Uploading community logos...');
  const entries = await Promise.all(
    LOGO_FILES.map((spec) => uploadImage(spec, opts.client, opts.seedToken)),
  );
  const uploaded = new Map<LogoKey, Id<'_storage'>>(entries);
  return {
    lot45: getUploadedId(uploaded, 'lot45'),
    sisterCity: getUploadedId(uploaded, 'sisterCity'),
    midnightSound: getUploadedId(uploaded, 'midnightSound'),
  };
}

// ── Stripe V2 seed account helpers ────────────────────────────────────────────

const SEED_METADATA_KEY = 'braket_seed';

/**
 * One-time cleanup of legacy V1 Express accounts left behind by the
 * pre-V2 seed. V2 direct-charge checkout is not compatible with V1
 * Express accounts, so we delete any that carry our `braket_seed`
 * metadata tag before creating their V2 replacements. Safe no-op once
 * the test Stripe account has no V1 seed accounts remaining.
 *
 * Only Express V1 accounts are deleted here. V2 accounts with the same
 * metadata tag also appear in the legacy list endpoint as `type: 'none'`
 * — those are the ones we want to KEEP and will pick up via
 * {@link findExistingSeedAccount} instead.
 */
async function cleanupLegacyV1SeedAccounts(stripe: Stripe): Promise<void> {
  const toDelete: Array<{id: string; role: string}> = [];
  for await (const account of stripe.accounts.list({limit: 100})) {
    const role = account.metadata?.[SEED_METADATA_KEY];
    if (!role) continue;
    if (account.type !== 'express') continue;
    toDelete.push({id: account.id, role});
  }
  if (toDelete.length === 0) return;
  console.log(
    `  Cleaning up ${toDelete.length} legacy V1 Express seed account(s)...`,
  );
  for (const {id, role} of toDelete) {
    try {
      await stripe.accounts.del(id);
      console.log(`    Deleted V1 ${role} account ${id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`    Could not delete V1 ${role} account ${id}: ${msg}`);
    }
  }
}

/**
 * Find a reusable V2 account for the given role by iterating
 * `applied_configurations: ['merchant']` accounts and matching our
 * metadata tag. The V2 list endpoint has no metadata filter, so the
 * match happens client-side.
 */
async function findExistingSeedAccount(
  stripe: Stripe,
  role: string,
): Promise<string | null> {
  // Stripe's V2 accounts list caps `limit` at 20 (unlike v1's 100).
  // The async iterator transparently paginates across pages.
  for await (const account of stripe.v2.core.accounts.list({
    limit: 20,
    applied_configurations: ['merchant'],
  })) {
    if (account.metadata?.[SEED_METADATA_KEY] !== role) continue;
    // Skip closed accounts — they can't be reopened and show up with
    // sparse fields. A future `create` call will need a fresh
    // idempotency key; the caller handles that.
    if (account.closed) continue;
    return account.id;
  }
  return null;
}

/**
 * Create a V2 connected account wired for direct-charge checkout.
 *
 * Uses {@link STRIPE_V2_ACCOUNT_CONFIG} so the seed account exactly
 * matches production-created accounts: `dashboard: 'none'`, Stripe
 * collects fees and losses, `card_payments` capability requested.
 *
 * Rerun safety is handled by {@link findExistingSeedAccount} (metadata
 * tag lookup), not by Stripe idempotency — a closed account plus the
 * same idempotency key yields a sticky 500 from Stripe that persists
 * until the key expires. Dropping the key means any duplicate created
 * during a rare race is trivially cleaned up via the tag filter.
 */
async function createSeedStripeAccount(
  stripe: Stripe,
  role: string,
  orgName: string,
  orgEmail: string,
): Promise<{id: string}> {
  const account = await stripe.v2.core.accounts.create({
    contact_email: orgEmail,
    display_name: orgName,
    ...STRIPE_V2_ACCOUNT_CONFIG,
    identity: {country: 'us'},
    metadata: {[SEED_METADATA_KEY]: role, organizerName: orgName},
  });
  return {id: account.id};
}

/**
 * Apply the manual-payout balance setting on the connected account so
 * the settlement ledger (not Stripe's default daily schedule) owns the
 * payout cadence. Mirrors production `ensureManualPayoutSettings` in
 * `backend/convex/stripe/_impl/accounts.ts`. Idempotent at Stripe:
 * re-setting `interval: 'manual'` on an already-manual account is a
 * no-op.
 */
async function configureSeedAccountPayouts(
  stripe: Stripe,
  accountId: string,
): Promise<void> {
  await stripe.balanceSettings.update(
    {
      payments: {
        payouts: {schedule: {interval: 'manual'}},
      },
    },
    {stripeAccount: accountId},
  );
}

interface SeedStripeAccountSpec {
  role: string;
  name: string;
  email: string;
}

interface SeedStripeAccountResult {
  id: string;
  status: ConnectedAccountStatus;
}

async function readSeedAccountStatus(
  stripe: Stripe,
  accountId: string,
): Promise<ConnectedAccountStatus> {
  const [account, balanceSettings] = await Promise.all([
    stripe.v2.core.accounts.retrieve(accountId, {
      include: [
        'configuration.merchant',
        'requirements',
        'future_requirements',
      ],
    }),
    stripe.balanceSettings.retrieve(undefined, {stripeAccount: accountId}),
  ]);
  return mapV2AccountStatus(account, balanceSettings);
}

async function ensureSeedStripeAccounts(stripe: Stripe): Promise<{
  lot45: SeedStripeAccountResult | null;
  sisterCity: SeedStripeAccountResult | null;
}> {
  await cleanupLegacyV1SeedAccounts(stripe);

  const accounts: SeedStripeAccountSpec[] = [
    {
      role: 'anfangszeit',
      name: 'Anfangszeit',
      email: 'anfangszeit@example.com',
    },
    {role: 'sister-city', name: 'Sister City', email: 'sistercity@example.com'},
  ];

  const results: Record<string, SeedStripeAccountResult> = {};
  const createdIds: Array<{role: string; id: string}> = [];

  for (const spec of accounts) {
    const existingId = await findExistingSeedAccount(stripe, spec.role);
    let accountId: string;
    if (existingId !== null) {
      console.log(
        `  Reusing existing V2 Stripe account for ${spec.role}: ${existingId}`,
      );
      accountId = existingId;
    } else {
      console.log(`  Creating V2 Stripe account for ${spec.role}...`);
      const created = await createSeedStripeAccount(
        stripe,
        spec.role,
        spec.name,
        spec.email,
      );
      accountId = created.id;
      createdIds.push({role: spec.role, id: accountId});
    }

    await configureSeedAccountPayouts(stripe, accountId);
    const status = await readSeedAccountStatus(stripe, accountId);
    results[spec.role] = {id: accountId, status};

    if (!status.chargesEnabled || status.onboardingStatus !== 'complete') {
      console.warn(
        `  ${spec.role} account ${accountId} is not checkout-ready ` +
          `(onboarding=${status.onboardingStatus}, charges=${String(status.chargesEnabled)}).`,
      );
      console.warn(
        '    Demo checkout for that community will stay disabled until Stripe onboarding is completed.',
      );
    }
  }

  if (createdIds.length > 0) {
    const sep = '='.repeat(70);
    console.log('');
    console.log(sep);
    console.log('  New V2 Stripe accounts created.');
    console.log(
      '  V2 accounts use embedded Connect components for post-onboarding account',
    );
    console.log(
      '  management. Some first-time KYC steps still open a Stripe-hosted',
    );
    console.log('  onboarding redirect from the Stripe settings page.');
    console.log(sep);
    for (const created of createdIds) {
      console.log(`    ${created.role}: ${created.id}`);
    }
    console.log(sep);
  }

  return {
    lot45: results['anfangszeit'] ?? null,
    sisterCity: results['sister-city'] ?? null,
  };
}

// ── Demo seed ──────────────────────────────────────────────────────────────────

interface UserCredential {
  key: UserKey;
  email: string;
  name: string;
  password: string;
  userId: SeedUserId;
}

function getSeedUserId(
  userIds: ReadonlyMap<UserKey, SeedUserId>,
  key: UserKey,
): SeedUserId {
  const userId = userIds.get(key);
  if (userId === undefined) {
    throw new Error(`Seed user ${key} was not created.`);
  }
  return userId;
}

async function runDemoSeed(
  seedClient: SeedClient,
  seedToken: string,
): Promise<void> {
  // Fresh mode: clear all data
  if (isFresh) {
    console.log('Clearing all data...');
    await seedClearAll(seedClient, seedToken, {}, {retryAuth: true});
    // clearAll only touches app tables — Better Auth component tables are isolated.
    // Delete BA users separately so sign-up creates fresh accounts with new passwords.
    console.log('Clearing Better Auth accounts...');
    const emails = USERS.map((u) => u.email);
    await seedClearBetterAuthUsers(seedClient, seedToken, emails);
    console.log('Cleared.');
  } else {
    // Idempotency check
    const exists = await seedCheckExists(seedClient, seedToken, {
      retryAuth: true,
    });
    if (exists) {
      console.log('Seed data already exists. Use --fresh to reset.');
      return;
    }
  }

  // Create users with generated passwords
  console.log('Creating users...');
  const credentials: UserCredential[] = [];
  const userIds = new Map<UserKey, SeedUserId>();

  for (const user of USERS) {
    const password = crypto.randomBytes(16).toString('base64url');
    console.log(`  ${user.email}...`);
    const result = await seedUserAndGetTokens(seedClient, seedToken, {
      email: user.email,
      password,
      name: user.name,
    });
    userIds.set(user.key, result.userId);
    credentials.push({...user, password, userId: result.userId});
  }

  // Create or reuse Stripe sandbox accounts
  let stripeAccountLot45: string | undefined;
  let stripeAccountSisterCity: string | undefined;
  let stripeAccountLot45Status: ConnectedAccountStatus | undefined;
  let stripeAccountSisterCityStatus: ConnectedAccountStatus | undefined;

  const stripeKey = process.env['STRIPE_SECRET_KEY'];
  if (stripeKey && stripeKey.startsWith('sk_test_')) {
    console.log('Setting up Stripe sandbox accounts...');
    try {
      const stripe = new Stripe(stripeKey);
      const accounts = await ensureSeedStripeAccounts(stripe);
      stripeAccountLot45 = accounts.lot45?.id;
      stripeAccountLot45Status = accounts.lot45?.status;
      stripeAccountSisterCity = accounts.sisterCity?.id;
      stripeAccountSisterCityStatus = accounts.sisterCity?.status;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Stripe setup failed: ${msg}`);
      console.warn('  Demo connected-account checkout will be disabled.');
    }
  } else if (stripeKey && !stripeKey.startsWith('sk_test_')) {
    throw new Error(
      'STRIPE_SECRET_KEY is a live key. Refusing to create sandbox accounts. Use a test key (sk_test_...) or unset STRIPE_SECRET_KEY.',
    );
  } else {
    console.log('No STRIPE_SECRET_KEY found — skipping Stripe account setup.');
    console.log('Demo connected-account checkout will be disabled.');
  }

  // Upload event posters and community logos
  const posterIds = await uploadPosters({client: seedClient, seedToken});
  const logoIds = await uploadLogos({client: seedClient, seedToken});

  // Seed all non-user data
  console.log('Seeding demo data...');
  await seedDemoData(seedClient, seedToken, {
    cooperId: getSeedUserId(userIds, 'cooperId'),
    kimId: getSeedUserId(userIds, 'kimId'),
    nomiId: getSeedUserId(userIds, 'nomiId'),
    barneyId: getSeedUserId(userIds, 'barneyId'),
    charlieId: getSeedUserId(userIds, 'charlieId'),
    tobiasId: getSeedUserId(userIds, 'tobiasId'),
    cherylId: getSeedUserId(userIds, 'cherylId'),
    posterIds,
    logoIds,
    stripeAccountLot45,
    stripeAccountLot45Status,
    stripeAccountSisterCity,
    stripeAccountSisterCityStatus,
  });

  // NOTE: Unlike the audit E2E setup (frontend/e2e/audit/audit.e2e-spec.ts),
  // local seed does not pre-wire the root admin as community_admin on Anfangszeit.

  // Print credential table
  console.log('\n' + '='.repeat(70));
  console.log('  Seed complete. Login credentials:');
  console.log('='.repeat(70));
  console.log('');

  for (const cred of credentials) {
    console.log(`  ${cred.email.padEnd(24)} ${cred.password}`);
    console.log(`  ${''.padEnd(24)} ${USER_ROLES[cred.key] ?? ''}`);
    console.log('');
  }

  if (stripeAccountLot45 || stripeAccountSisterCity) {
    console.log('  Stripe sandbox accounts:');
    if (stripeAccountLot45) {
      console.log(`    Anfangszeit: ${stripeAccountLot45}`);
    }
    if (stripeAccountSisterCity) {
      console.log(`    Sister City: ${stripeAccountSisterCity}`);
    }
    console.log('');
  }

  console.log('='.repeat(70));
  console.log(
    '  Passwords are not stored. Re-run with --fresh for new credentials.',
  );
  console.log('='.repeat(70));
}

async function runClearOnly(
  seedClient: SeedClient,
  seedToken: string,
): Promise<void> {
  console.log('Clearing all app data...');
  await seedClearAll(seedClient, seedToken, {}, {retryAuth: true});
  console.log('Clearing seed Better Auth accounts...');
  await seedClearBetterAuthUsers(
    seedClient,
    seedToken,
    USERS.map((u) => u.email),
  );
  console.log('Clear-only seed reset complete.');
}

// ── Sandbox fixture ────────────────────────────────────────────────────────────

async function runFixture(
  convexUrl: string,
  seedClient: SeedClient,
  seedToken: string,
): Promise<void> {
  const stripeConnectedAccountId =
    process.env['STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID'];
  if (!stripeConnectedAccountId) {
    throw new Error(
      'STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID is required. Set it in Doppler (local/stg) and retry.',
    );
  }

  // Pre-flight: ensure seed functions are enabled on target deployment.
  try {
    await seedCheckExists(seedClient, seedToken, {
      retryAuth: true,
    });
  } catch (error: unknown) {
    if (getSeedErrorText(error).includes('Seed authorization failed')) {
      throw new Error(
        'Seed authorization is not enabled on this deployment. The seed script manages DEV_SEED and DEV_SEED_TOKEN automatically.',
        {cause: error},
      );
    }
    throw error;
  }

  const fixtureArgs: SeedSandboxPurchaseFixtureArgs = {
    stripeConnectedAccountId,
  };

  const organizerSlug = getArgValue('--organizer-slug');
  const organizerName = getArgValue('--organizer-name');
  const organizerEmail = getArgValue('--organizer-email');
  const eventTitle = getArgValue('--event-title');
  const eventDate = getArgValue('--event-date');

  if (organizerSlug !== null) fixtureArgs['organizerSlug'] = organizerSlug;
  if (organizerName !== null) fixtureArgs['organizerName'] = organizerName;
  if (organizerEmail !== null) fixtureArgs['organizerEmail'] = organizerEmail;
  if (eventTitle !== null) fixtureArgs['eventTitle'] = eventTitle;
  if (eventDate !== null) fixtureArgs['eventDate'] = eventDate;

  console.log(`Target: ${convexUrl}${isLocalUrl(convexUrl) ? ' (local)' : ''}`);
  console.log('Upserting sandbox purchase fixture...');

  const result = await seedSandboxPurchaseFixture(
    seedClient,
    seedToken,
    fixtureArgs,
  );

  if (!result || !result.eventId || !result.organizerId) {
    throw new Error('Failed to parse fixture result from Convex output.');
  }

  console.log('');
  console.log('Sandbox fixture ready:');
  console.log(`  Organizer ID: ${result.organizerId}`);
  console.log(`  Event ID:     ${result.eventId}`);
  console.log(`  Event Path:   ${result.eventPath}`);
  console.log(
    `  Created:      organizer=${String(result.organizerCreated)}, event=${String(result.eventCreated)}`,
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const convexUrl = await resolveConvexUrl();
  process.env['CONVEX_URL'] = convexUrl;

  // Safety: refuse to seed production
  if (convexUrl.includes(PROD_DEPLOYMENT_SLUG)) {
    console.error(
      `Error: Refusing to seed production deployment (${PROD_DEPLOYMENT_SLUG})`,
    );
    process.exit(1);
  }

  // Enforce local URL for --target local
  if (isLocal && !isLocalUrl(convexUrl)) {
    console.error(
      `[seed] Refusing to seed non-local Convex URL with --target local: ${convexUrl}. ` +
        'Pass --url http://127.0.0.1:3210 (or localhost), or use --target dev.',
    );
    process.exit(1);
  }

  // Resolve admin key for local backends
  let adminKey: string | undefined;
  if (isLocalUrl(convexUrl)) {
    adminKey = resolveLocalAdminKey() ?? ADMIN_KEY;
    if (!adminKey) {
      console.error('Error: local CONVEX admin key not found.');
      console.error(
        `Set CONVEX_ADMIN_KEY (or CONVEX_LOCAL_ADMIN_KEY) or ensure ${LOCAL_ADMIN_KEY_FILE} exists.`,
      );
      process.exit(1);
    }
  }

  const envTarget = resolveSeedEnvTarget({
    convexUrl,
    isLocal: isLocalUrl(convexUrl),
    adminKey,
    deployKey: process.env['CONVEX_DEPLOY_KEY'],
    allowedRemoteDeployments: [STAGING_DEPLOYMENT_SLUG],
  });

  const seedClient = createSeedClient(convexUrl);

  console.log(
    `Target: ${convexUrl}${isLocalUrl(convexUrl) ? ' (local)' : isDev ? ' (dev)' : ''}`,
  );

  const seedToken = crypto.randomBytes(32).toString('base64url');
  const seedExpiresAt = String(Date.now() + SEED_SESSION_TTL_MS);

  // Temporarily enable a token-gated seed session.
  const cleanupTarget: SeedCleanupTarget =
    envTarget.kind === 'remote'
      ? {
          ...envTarget,
          dopplerProject: process.env['DOPPLER_PROJECT'] ?? 'braket-tickets',
          dopplerConfig: process.env['DOPPLER_CONFIG'] ?? 'stg',
        }
      : envTarget;
  const seedEnvSession = createSeedEnvSession({
    target: cleanupTarget,
    setEnv: (name: DevSeedEnvVar, value: string) =>
      convexEnvSet(name, value, envTarget),
    removeEnv: (name: DevSeedEnvVar) => convexEnvRemove(name, envTarget),
  });

  const cleanupDevSeed = (): boolean => {
    const result = seedEnvSession.cleanup();
    if (result.attempted.length === 0) return true;
    console.log(`Removing DEV_SEED session env vars on ${convexUrl}...`);
    if (result.failed.length === 0) return true;
    console.error(
      `ERROR: Failed to remove seed env var(s): ${result.failed.join(', ')}`,
    );
    console.error('Run these cleanup commands manually before retrying:');
    for (const command of result.cleanupCommands) {
      console.error(`  ${command}`);
    }
    return false;
  };

  let runError: unknown;
  try {
    console.log(`Temporarily enabling token-gated DEV_SEED on ${convexUrl}...`);
    seedEnvSession.set('DEV_SEED', 'true');
    seedEnvSession.set('DEV_SEED_TOKEN', seedToken);
    seedEnvSession.set('DEV_SEED_EXPIRES_AT', seedExpiresAt);

    if (isClearOnly) {
      await runClearOnly(seedClient, seedToken);
    } else if (isFixture) {
      await runFixture(convexUrl, seedClient, seedToken);
    } else {
      await runDemoSeed(seedClient, seedToken);
    }
  } catch (error: unknown) {
    runError = error;
  }

  const cleanupOk = cleanupDevSeed();
  if (runError !== undefined) {
    throw runError;
  }
  if (!cleanupOk) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Seed failed:', msg);
  process.exitCode = 1;
});
