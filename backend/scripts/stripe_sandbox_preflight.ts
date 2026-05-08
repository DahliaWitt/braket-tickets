#!/usr/bin/env tsx
import Stripe from 'stripe';

interface KeySpec {
  name: string;
  label: string;
  validator: (value: string) => boolean;
  explanation: string;
}

const REQUIRED_KEYS: KeySpec[] = [
  {
    name: 'STRIPE_SECRET_KEY',
    label: 'Stripe secret key',
    validator: (value) => /^sk_(?:test|live)_[A-Za-z0-9]+$/.test(value),
    explanation:
      'Use a Stripe secret key prefixed with sk_test_ for sandbox lanes, or sk_live_ for live credentials.',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    label: 'Webhook signing secret',
    validator: (value) => /^whsec_[A-Za-z0-9]+$/.test(value),
    explanation: 'Expected a webhook signing secret prefixed with whsec_.',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET_V2_EVENTS',
    label: 'Accounts V2 event destination signing secret',
    validator: (value) => /^whsec_[A-Za-z0-9]+$/.test(value),
    explanation:
      'Expected the Accounts V2 event destination webhook signing secret prefixed with whsec_.',
  },
];

const isCi =
  process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';

function getOptionalConnectedAccountId(): string {
  return (
    process.env['STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID'] ||
    process.env['STRIPE_CONNECTED_ACCOUNT_ID'] ||
    ''
  );
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

interface ValidationResult {
  errors: string[];
  warnings: string[];
  connectedAccountId: string;
}

function validateVariables(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const {name, label, validator, explanation} of REQUIRED_KEYS) {
    const value = process.env[name];

    if (!isNonEmptyString(value)) {
      errors.push(
        `Missing ${label} (${name}). Set ${name} in CI secrets/environment and retry.`,
      );
      continue;
    }

    if (!validator(value)) {
      errors.push(`${label} (${name}) has invalid format. ${explanation}`);
    }
  }

  const sandboxMode = process.env['STRIPE_SANDBOX_CONTRACT_TESTS'];
  if (sandboxMode !== 'true') {
    if (isCi) {
      errors.push(
        'STRIPE_SANDBOX_CONTRACT_TESTS must be true for CI contract runs.',
      );
    } else {
      warnings.push(
        'STRIPE_SANDBOX_CONTRACT_TESTS is not set to "true"; sandbox contract tests may remain disabled.',
      );
    }
  }

  const connectedAccountId = getOptionalConnectedAccountId();
  const hasConnectedAccount = isNonEmptyString(connectedAccountId);
  const hasSandboxConnectedAccount = isNonEmptyString(
    process.env['STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID'],
  );
  if (!hasConnectedAccount) {
    if (isCi) {
      errors.push(
        'Missing connected account id for CI sandbox tests. Set STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID.',
      );
    } else {
      warnings.push(
        'No STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID set; tests may create a temporary connected account when enabled.',
      );
    }
  } else if (!/^acct_[A-Za-z0-9]+$/.test(connectedAccountId)) {
    errors.push(
      `${hasSandboxConnectedAccount ? 'STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID' : 'STRIPE_CONNECTED_ACCOUNT_ID'} should look like acct_... (received ${connectedAccountId}).`,
    );
  }

  if (isCi && !process.env['STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID']) {
    errors.push(
      'Set STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID specifically for CI; fallback env vars are not accepted in deterministic lanes.',
    );
  }

  const secretKey = process.env['STRIPE_SECRET_KEY'] ?? '';
  if (sandboxMode === 'true' && !secretKey.startsWith('sk_test_')) {
    errors.push(
      'Sandbox contract lane requires test-mode Stripe credentials. Expected STRIPE_SECRET_KEY to start with sk_test_.',
    );
  }

  return {errors, warnings, connectedAccountId};
}

async function validateConnectedAccountCapability({
  errors,
  warnings,
  connectedAccountId,
}: ValidationResult): Promise<void> {
  if (!connectedAccountId) {
    return;
  }

  const secretKey = process.env['STRIPE_SECRET_KEY'] ?? '';
  if (!secretKey.startsWith('sk_test_')) {
    return;
  }

  try {
    const stripe = new Stripe(secretKey);
    const account = await stripe.accounts.retrieve(connectedAccountId);
    const transfersCapability = account.capabilities?.transfers;
    const cardPaymentsCapability = account.capabilities?.card_payments;
    const capabilityReady =
      account.charges_enabled &&
      account.payouts_enabled &&
      account.details_submitted &&
      transfersCapability === 'active' &&
      cardPaymentsCapability === 'active';

    if (capabilityReady) {
      return;
    }

    const issueMessage =
      `Connected account ${connectedAccountId} is not fully sandbox-ready. ` +
      `details_submitted=${String(account.details_submitted)}, ` +
      `charges_enabled=${String(account.charges_enabled)}, ` +
      `payouts_enabled=${String(account.payouts_enabled)}, ` +
      `capabilities.transfers=${String(transfersCapability)}, ` +
      `capabilities.card_payments=${String(cardPaymentsCapability)}. ` +
      `Complete Stripe test onboarding/capabilities for deterministic destination charges.`;

    if (isCi) {
      errors.push(issueMessage);
    } else {
      warnings.push(issueMessage);
    }
  } catch (error: unknown) {
    const message =
      error !== null && typeof error === 'object' && 'message' in error
        ? String((error as {message: unknown}).message)
        : String(error);
    const issueMessage = `Failed to validate connected account ${connectedAccountId} capability via Stripe API: ${message}`;
    if (isCi) {
      errors.push(issueMessage);
    } else {
      warnings.push(issueMessage);
    }
  }
}

async function validate(): Promise<void> {
  const {errors, warnings, connectedAccountId} = validateVariables();
  await validateConnectedAccountCapability({
    errors,
    warnings,
    connectedAccountId,
  });

  if (errors.length === 0) {
    if (warnings.length > 0) {
      for (const warning of warnings) {
        console.log(`WARN: ${warning}`);
      }
      console.log('Preflight checks passed with non-blocking warnings.');
      return;
    }

    console.log('Stripe sandbox preflight checks passed.');
    return;
  }

  const heading = isCi
    ? 'Stripe sandbox preflight failed (strict CI mode).'
    : 'Stripe sandbox preflight failed.';

  console.error(heading);
  for (const message of errors) {
    console.error(`- ${message}`);
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`WARN: ${warning}`);
    }
  }

  console.error(
    '\nHint: run pnpm test:convex:sandbox:preflight with complete Stripe sandbox env vars.',
  );
  process.exitCode = 1;
}

void validate();
