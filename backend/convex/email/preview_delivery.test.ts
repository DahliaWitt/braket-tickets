import {afterEach, describe, expect, it, vi} from 'vitest';
import {internal} from '../_generated/api';
import type {ActionCtx} from '../_generated/server';
import {
  convexTest,
  finishAllScheduledFunctions,
  restoreEnv,
  snapshotEnv,
} from '../setup.testing';
import {
  enqueueEmailDelivery,
  sendEmailDeliveryNow,
} from '../lib/email_delivery_wrapper';
import {dispatchEmailChangeConfirmation} from '../lib/better_auth';

/**
 * Contract tests for preview (Ethereal/SMTP) email delivery.
 *
 * Every other backend test runs with IS_TEST=true, which makes the delivery
 * wrapper capture emails BEFORE the provider action's argument validator ever
 * executes. That gap shipped a production-blocking bug: the wrapper spread the
 * internal-only `requireDelivery` flag into email/smtp:sendPreview, whose
 * validator rejects unknown fields, so critical email-change confirmations
 * failed at runtime on every non-production deployment while all tests stayed
 * green.
 *
 * These tests clear IS_TEST and run the real provider actions (with only the
 * nodemailer transport mocked) so the production-shaped payload must pass the
 * real sendPreview validator.
 */

const {sendMailMock} = vi.hoisted(() => ({sendMailMock: vi.fn()}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({sendMail: sendMailMock}),
  },
}));

const ENV_KEYS = [
  'IS_TEST',
  'CONVEX_CLOUD_URL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
  'EMAIL_FROM',
  'EMAIL_REPLY_TO',
] as const;

/**
 * Preview mode as seen on the dev deployment: IS_TEST is not honored
 * (or unset), the deployment does not look like production, and Ethereal
 * SMTP credentials are configured.
 */
function usePreviewModeEnv({configured = true} = {}) {
  delete process.env['IS_TEST'];
  delete process.env['CONVEX_CLOUD_URL'];
  if (configured) {
    process.env['SMTP_USER'] = 'ethereal-user@ethereal.email';
    process.env['SMTP_PASS'] = 'ethereal-pass';
    process.env['EMAIL_FROM'] = 'tickets@braket.test';
  } else {
    delete process.env['SMTP_USER'];
    delete process.env['SMTP_PASS'];
  }
}

/**
 * The exact payload/metadata shape dispatchEmailSend produces for the
 * account email-change confirmation (source 'auth', requireDelivery).
 */
const emailChangePayload = {
  to: 'current-owner@example.com',
  subject: 'confirm ur email change',
  html: '<p>someone (hopefully u) wants to change ur email uwu</p>',
};

const emailChangeMetadata = {
  source: 'auth' as const,
  sourceId: 'dispatch',
  recipient: 'current-owner@example.com',
  critical: true,
  requireDelivery: true,
};

function actionDeliveryCtx(t: ReturnType<typeof convexTest>) {
  return {
    runAction: t.action.bind(t),
    runMutation: t.mutation.bind(t),
  } as unknown as Pick<ActionCtx, 'runAction' | 'runMutation'>;
}

describe('Preview email delivery contract', () => {
  afterEach(() => {
    sendMailMock.mockReset();
    vi.restoreAllMocks();
  });

  it('delivers a queued critical email-change payload through the real sendPreview validator', async () => {
    const env = snapshotEnv(ENV_KEYS);
    vi.useFakeTimers();
    usePreviewModeEnv();
    sendMailMock.mockResolvedValue({messageId: 'ethereal-message-id'});
    try {
      const t = convexTest();

      // Mutation-context dispatch, exactly as requestEmailChange schedules it.
      await t.run(async (ctx) => {
        await enqueueEmailDelivery(ctx, emailChangePayload, {
          ...emailChangeMetadata,
        });
      });

      await finishAllScheduledFunctions(t);

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: emailChangePayload.to,
          subject: emailChangePayload.subject,
        }),
      );

      const deliveries = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        source: 'auth',
        sourceId: 'dispatch',
        recipient: emailChangePayload.to,
        provider: 'smtp',
        critical: true,
      });

      const failures = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );
      expect(failures).toHaveLength(0);
    } finally {
      vi.useRealTimers();
      restoreEnv(ENV_KEYS, env);
    }
  });

  it('delivers the production email-change confirmation dispatch end to end', async () => {
    const env = snapshotEnv(ENV_KEYS);
    vi.useFakeTimers();
    usePreviewModeEnv();
    sendMailMock.mockResolvedValue({messageId: 'ethereal-message-id'});
    try {
      const t = convexTest();

      // Highest production-shaped entry point reachable in convex-test: the
      // Better Auth sendChangeEmailConfirmation hook delegates here verbatim.
      await t.run(async (ctx) => {
        await dispatchEmailChangeConfirmation(ctx, {
          to: 'current-owner@example.com',
          newEmail: 'fresh-address@example.com',
          url: 'https://example.convex.site/verify?token=abc',
        });
      });

      await finishAllScheduledFunctions(t);

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const [mailArgs] = sendMailMock.mock.calls[0] as [
        {to: string; html: string},
      ];
      expect(mailArgs.to).toBe('current-owner@example.com');
      expect(mailArgs.html).toContain('fresh-address@example.com');

      const deliveries = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        source: 'auth',
        recipient: 'current-owner@example.com',
        provider: 'smtp',
        critical: true,
      });
    } finally {
      vi.useRealTimers();
      restoreEnv(ENV_KEYS, env);
    }
  });

  it('fails the email-change request at dispatch when required delivery is unconfigured', async () => {
    const env = snapshotEnv(ENV_KEYS);
    usePreviewModeEnv({configured: false});
    try {
      const t = convexTest();

      await expect(
        t.run(async (ctx) => {
          // Mirror a real mutation ctx: scheduler but no runAction, so
          // dispatchEmailSend takes the scheduler branch and its
          // required-delivery guard must throw BEFORE anything is enqueued.
          const mutationCtx = {
            scheduler: ctx.scheduler,
            runMutation: ctx.runMutation,
          } as unknown as Parameters<typeof dispatchEmailChangeConfirmation>[0];
          await dispatchEmailChangeConfirmation(mutationCtx, {
            to: 'current-owner@example.com',
            newEmail: 'fresh-address@example.com',
            url: 'https://example.convex.site/verify?token=abc',
          });
        }),
      ).rejects.toThrow(/required but not configured/i);

      expect(sendMailMock).not.toHaveBeenCalled();
      const deliveries = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );
      expect(deliveries).toHaveLength(0);
    } finally {
      restoreEnv(ENV_KEYS, env);
    }
  });

  it('delivers immediately from action contexts through the real sendPreview validator', async () => {
    const env = snapshotEnv(ENV_KEYS);
    usePreviewModeEnv();
    sendMailMock.mockResolvedValue({messageId: 'ethereal-message-id'});
    try {
      const t = convexTest();

      await sendEmailDeliveryNow(
        actionDeliveryCtx(t),
        emailChangePayload,
        emailChangeMetadata,
      );

      expect(sendMailMock).toHaveBeenCalledTimes(1);
      const deliveries = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({provider: 'smtp', critical: true});
    } finally {
      restoreEnv(ENV_KEYS, env);
    }
  });

  it('propagates SMTP transport failure and records it — no false success', async () => {
    const env = snapshotEnv(ENV_KEYS);
    usePreviewModeEnv();
    // Client-error shape so withRetry does not retry (statusCode 4xx).
    sendMailMock.mockRejectedValue(
      Object.assign(new Error('mailbox unavailable'), {statusCode: 450}),
    );
    try {
      const t = convexTest();

      await expect(
        sendEmailDeliveryNow(
          actionDeliveryCtx(t),
          emailChangePayload,
          emailChangeMetadata,
        ),
      ).rejects.toThrow(/failed to send preview email/i);

      const deliveries = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );
      expect(deliveries).toHaveLength(0);

      const failures = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        source: 'auth',
        recipient: emailChangePayload.to,
      });
      expect(failures[0].error).toMatch(/preview smtp failed/i);
    } finally {
      restoreEnv(ENV_KEYS, env);
    }
  });

  it('propagates missing SMTP configuration and records it — no false success', async () => {
    const env = snapshotEnv(ENV_KEYS);
    usePreviewModeEnv({configured: false});
    try {
      const t = convexTest();

      await expect(
        sendEmailDeliveryNow(
          actionDeliveryCtx(t),
          emailChangePayload,
          emailChangeMetadata,
        ),
      ).rejects.toThrow(/not configured/i);

      expect(sendMailMock).not.toHaveBeenCalled();
      const failures = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );
      expect(failures).toHaveLength(1);
      expect(failures[0].error).toMatch(/preview smtp failed/i);
    } finally {
      restoreEnv(ENV_KEYS, env);
    }
  });

  it('enforces the provider contract even in IS_TEST capture mode', async () => {
    const env = snapshotEnv(ENV_KEYS);
    process.env['IS_TEST'] = 'true';
    delete process.env['CONVEX_CLOUD_URL'];
    try {
      const t = convexTest();

      // A payload that drifts from the provider contract (extra unknown
      // field smuggled past TypeScript) must fail in capture mode too —
      // otherwise IS_TEST runs green-light payloads deployed validators
      // reject.
      const driftedPayload = {
        ...emailChangePayload,
        internalOnlyFlag: true,
      } as unknown as typeof emailChangePayload;

      await expect(
        t.run(async (ctx) => {
          await enqueueEmailDelivery(ctx, driftedPayload, emailChangeMetadata);
        }),
      ).rejects.toThrow(/internalOnlyFlag/);

      // The production-shaped payload (requireDelivery folded into critical)
      // still captures cleanly.
      await t.run(async (ctx) => {
        await enqueueEmailDelivery(ctx, emailChangePayload, {
          ...emailChangeMetadata,
        });
      });
      expect(sendMailMock).not.toHaveBeenCalled();
    } finally {
      restoreEnv(ENV_KEYS, env);
    }
  });

  it('rejects internal-only dispatch flags at the provider boundary', async () => {
    const env = snapshotEnv(ENV_KEYS);
    usePreviewModeEnv();
    try {
      const t = convexTest();
      const {requireDelivery: _requireDelivery, ...providerMetadata} =
        emailChangeMetadata;

      await expect(
        t.action(internal.email.smtp.sendPreview, {
          ...emailChangePayload,
          ...providerMetadata,
          requireDelivery: true,
        } as never),
      ).rejects.toThrow(/requireDelivery/);

      expect(sendMailMock).not.toHaveBeenCalled();

      // resend_actions.send keeps transitional tolerance for one release so
      // jobs scheduled by the pre-contract wrapper survive the deploy window.
      // The value is accepted but ignored; in preview mode the job routes to
      // sendPreview with clean args and still delivers.
      sendMailMock.mockResolvedValue({messageId: 'ethereal-message-id'});
      await expect(
        t.action(internal.email.resend_actions.send, {
          ...emailChangePayload,
          ...providerMetadata,
          requireDelivery: true,
        } as never),
      ).resolves.toBeNull();
      expect(sendMailMock).toHaveBeenCalledTimes(1);
    } finally {
      restoreEnv(ENV_KEYS, env);
    }
  });
});
