import {ConvexHttpClient} from 'convex/browser';
import type {FunctionArgs, FunctionReturnType} from 'convex/server';
import {api} from '../convex/_generated/api.js';

export type SeedClient = ConvexHttpClient;
export type SeedDemoDataArgs = Omit<
  FunctionArgs<typeof api.seed.ops.seedDemoData>,
  'seedToken'
>;
export type SeedPosterIds = NonNullable<SeedDemoDataArgs['posterIds']>;
export type SeedLogoIds = NonNullable<SeedDemoDataArgs['logoIds']>;
export type SeedSandboxPurchaseFixtureArgs = Omit<
  FunctionArgs<typeof api.seed.ops.seedSandboxPurchaseFixture>,
  'seedToken'
>;
export type SeedSandboxPurchaseFixtureResult = FunctionReturnType<
  typeof api.seed.ops.seedSandboxPurchaseFixture
>;
export type SeedUserAndGetTokensArgs = Omit<
  FunctionArgs<typeof api.seed.actions.seedUserAndGetTokens>,
  'seedToken'
>;
export type SeedUserAndGetTokensResult = FunctionReturnType<
  typeof api.seed.actions.seedUserAndGetTokens
>;
export type SeedUserId = SeedUserAndGetTokensResult['userId'];

export function getSeedErrorText(error: unknown): string {
  if (error instanceof Error) {
    const stderr =
      'stderr' in error &&
      typeof (error as {stderr?: unknown}).stderr === 'string'
        ? (error as {stderr: string}).stderr
        : '';
    const stdout =
      'stdout' in error &&
      typeof (error as {stdout?: unknown}).stdout === 'string'
        ? (error as {stdout: string}).stdout
        : '';
    return `${error.message}\n${stdout}\n${stderr}`;
  }
  return String(error);
}

async function runSeedCall<T>(
  operation: () => Promise<T>,
  runOpts: {retryAuth?: boolean} = {},
): Promise<T> {
  const maxAttempts = runOpts.retryAuth ? 6 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error: unknown) {
      const text = getSeedErrorText(error);
      const shouldRetry =
        runOpts.retryAuth === true &&
        attempt < maxAttempts &&
        text.includes('Seed authorization failed');
      if (!shouldRetry) {
        throw error;
      }
      const delayMs = 1000 * attempt;
      console.warn(
        `Seed authorization is not visible yet; retrying in ${delayMs / 1000}s...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Seed authorization retry loop exhausted');
}

export function createSeedClient(convexUrl: string): SeedClient {
  return new ConvexHttpClient(convexUrl, {
    logger: false,
    skipConvexDeploymentUrlCheck: true,
  });
}

export async function seedCheckExists(
  client: SeedClient,
  seedToken: string,
  runOpts: {retryAuth?: boolean} = {},
): Promise<boolean> {
  return await runSeedCall(
    () => client.query(api.seed.ops.checkSeedExists, {seedToken}),
    runOpts,
  );
}

export async function seedGenerateUploadUrl(
  client: SeedClient,
  seedToken: string,
): Promise<string> {
  return await runSeedCall(() =>
    client.mutation(api.seed.ops.generateUploadUrl, {seedToken}),
  );
}

export async function seedClearAll(
  client: SeedClient,
  seedToken: string,
  args: {keepUsers?: boolean} = {},
  runOpts: {retryAuth?: boolean} = {},
): Promise<void> {
  await runSeedCall(
    () => client.mutation(api.seed.ops.clearAll, {...args, seedToken}),
    runOpts,
  );
}

export async function seedClearBetterAuthUsers(
  client: SeedClient,
  seedToken: string,
  emails: string[],
): Promise<void> {
  await runSeedCall(() =>
    client.action(api.seed.actions.clearBetterAuthUsers, {emails, seedToken}),
  );
}

export async function seedUserAndGetTokens(
  client: SeedClient,
  seedToken: string,
  args: SeedUserAndGetTokensArgs,
): Promise<SeedUserAndGetTokensResult> {
  return await runSeedCall(() =>
    client.action(api.seed.actions.seedUserAndGetTokens, {
      ...args,
      seedToken,
    }),
  );
}

export async function seedDemoData(
  client: SeedClient,
  seedToken: string,
  args: SeedDemoDataArgs,
): Promise<void> {
  await runSeedCall(() =>
    client.mutation(api.seed.ops.seedDemoData, {...args, seedToken}),
  );
}

export async function seedSandboxPurchaseFixture(
  client: SeedClient,
  seedToken: string,
  args: SeedSandboxPurchaseFixtureArgs,
): Promise<SeedSandboxPurchaseFixtureResult> {
  return await runSeedCall(() =>
    client.mutation(api.seed.ops.seedSandboxPurchaseFixture, {
      ...args,
      seedToken,
    }),
  );
}
