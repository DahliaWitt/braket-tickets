import {afterEach, describe, expect, it, vi} from 'vitest';
import {api, internal} from '../_generated/api';
import {convexTest, finishAllScheduledFunctions} from '../setup.testing';
import {
  enqueueEmailDelivery,
  sendEmailDeliveryNow,
} from '../lib/email_delivery_wrapper';

const ENV_KEYS = [
  'IS_TEST',
  'RESEND_API_KEY',
  'CONVEX_CLOUD_URL',
  'EMAIL_FROM',
  'EMAIL_REPLY_TO',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
] as const;

function snapshotEnv(): Partial<Record<(typeof ENV_KEYS)[number], string>> {
  return Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]).filter(
      (entry): entry is [(typeof ENV_KEYS)[number], string] =>
        entry[1] !== undefined,
    ),
  );
}

function restoreEnv(
  snapshot: Partial<Record<(typeof ENV_KEYS)[number], string>>,
) {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

describe('Resend email delivery wrapper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures test emails before contacting Resend', async () => {
    const originalIsTest = process.env.IS_TEST;
    process.env.IS_TEST = 'true';
    try {
      const t = convexTest();

      await t.run(async (ctx) => {
        await enqueueEmailDelivery(
          ctx,
          {
            to: 'capture@example.com',
            subject: 'Captured',
            html: '<p>captured</p>',
          },
          {
            source: 'auth',
            sourceId: 'test',
            recipient: 'capture@example.com',
            critical: true,
          },
        );
      });

      const emails = await t.query(api.testing.email.getSentEmails, {
        to: 'capture@example.com',
      });
      expect(emails).toHaveLength(1);
      expect(emails[0].subject).toBe('Captured');
    } finally {
      if (originalIsTest === undefined) {
        delete process.env.IS_TEST;
      } else {
        process.env.IS_TEST = originalIsTest;
      }
    }
  });

  it('captures immediate test emails from action contexts before contacting Resend', async () => {
    const originalIsTest = process.env.IS_TEST;
    process.env.IS_TEST = 'true';
    try {
      const t = convexTest();

      await t.run(async (ctx) => {
        await sendEmailDeliveryNow(
          ctx,
          {
            to: 'action-capture@example.com',
            subject: 'Action Captured',
            html: '<p>captured from action context</p>',
          },
          {
            source: 'auth',
            sourceId: 'test',
            recipient: 'action-capture@example.com',
            critical: true,
          },
        );
      });

      const emails = await t.query(api.testing.email.getSentEmails, {
        to: 'action-capture@example.com',
      });
      expect(emails).toHaveLength(1);
      expect(emails[0].subject).toBe('Action Captured');
    } finally {
      if (originalIsTest === undefined) {
        delete process.env.IS_TEST;
      } else {
        process.env.IS_TEST = originalIsTest;
      }
    }
  });

  it('does not capture queued emails when IS_TEST is set on a production-like deployment', async () => {
    const env = snapshotEnv();
    vi.useFakeTimers();
    process.env.IS_TEST = 'true';
    process.env.CONVEX_CLOUD_URL = 'https://prod.example.convex.cloud';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'tickets@example.com';
    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({id: 'resend-provider-id'}), {
          status: 200,
          headers: {'content-type': 'application/json'},
        }),
      );
      const t = convexTest();

      await t.run(async (ctx) => {
        await enqueueEmailDelivery(
          ctx,
          {
            to: 'queued-prod@example.com',
            subject: 'Queued production',
            html: '<p>queued production</p>',
          },
          {
            source: 'auth',
            sourceId: 'queued-prod',
            recipient: 'queued-prod@example.com',
            critical: true,
          },
        );
      });

      const captured = await t.query(api.testing.email.getSentEmails, {
        to: 'queued-prod@example.com',
      });
      expect(captured).toHaveLength(0);
      await finishAllScheduledFunctions(t);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const deliveries = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        source: 'auth',
        sourceId: 'queued-prod',
        recipient: 'queued-prod@example.com',
        provider: 'resend',
        fallback: false,
      });
    } finally {
      vi.useRealTimers();
      restoreEnv(env);
    }
  });

  it('captures sanitized attachment metadata in test mode', async () => {
    const originalIsTest = process.env.IS_TEST;
    process.env.IS_TEST = 'true';
    try {
      const t = convexTest();

      await t.action(internal.email.resend_actions.send, {
        to: 'attachment@example.com',
        subject: 'Attachment',
        html: '<p>attachment</p>',
        attachments: [
          {
            filename: 'ticket.pdf',
            content: 'base64-pdf-content',
            contentType: 'application/pdf',
          },
          {
            filename: 'qrcode.png',
            content: 'base64-png-content',
            contentType: 'image/png',
            cid: 'qrcode',
          },
        ],
        source: 'ticket',
        sourceId: 'order-attachment',
        recipient: 'attachment@example.com',
        critical: true,
      });

      const emails = await t.query(api.testing.email.getSentEmails, {
        to: 'attachment@example.com',
      });
      expect(emails).toHaveLength(1);
      expect(emails[0].attachments).toEqual([
        {
          filename: 'ticket.pdf',
          contentType: 'application/pdf',
          size: 'base64-pdf-content'.length,
        },
        {
          filename: 'qrcode.png',
          contentType: 'image/png',
          cid: 'qrcode',
          size: 'base64-png-content'.length,
        },
      ]);
    } finally {
      if (originalIsTest === undefined) {
        delete process.env.IS_TEST;
      } else {
        process.env.IS_TEST = originalIsTest;
      }
    }
  });

  it('sends manual attachment payloads through Resend with cid mapped to contentId', async () => {
    const env = snapshotEnv();
    process.env.IS_TEST = 'false';
    process.env.CONVEX_CLOUD_URL = 'https://prod.example.convex.cloud';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'tickets@example.com';
    process.env.EMAIL_REPLY_TO = 'support@example.com';
    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({id: 'resend-provider-id'}), {
          status: 200,
          headers: {'content-type': 'application/json'},
        }),
      );
      const t = convexTest();

      await t.action(internal.email.resend_actions.send, {
        to: 'buyer@example.com',
        subject: 'Tickets',
        html: '<img src="cid:qrcode">',
        attachments: [
          {
            filename: 'ticket.pdf',
            content: 'pdf-base64',
            contentType: 'application/pdf',
          },
          {
            filename: 'qrcode.png',
            content: 'png-base64',
            contentType: 'image/png',
            cid: 'qrcode',
          },
        ],
        source: 'ticket',
        sourceId: 'order-manual',
        recipient: 'buyer@example.com',
        critical: true,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, request] = fetchMock.mock.calls[0];
      const body = JSON.parse((request as RequestInit).body as string) as {
        attachments: Array<{
          filename: string;
          content: string;
          content_type: string;
          content_id?: string;
        }>;
        reply_to: string[];
      };
      expect(body.attachments).toEqual([
        {
          filename: 'ticket.pdf',
          content: 'pdf-base64',
          content_type: 'application/pdf',
        },
        {
          filename: 'qrcode.png',
          content: 'png-base64',
          content_type: 'image/png',
          content_id: 'qrcode',
        },
      ]);
      expect(body.reply_to).toEqual(['support@example.com']);

      const deliveries = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        source: 'ticket',
        sourceId: 'order-manual',
        recipient: 'buyer@example.com',
        provider: 'resend',
        manual: true,
        fallback: false,
      });
    } finally {
      restoreEnv(env);
    }
  });

  it('does not capture manual sends when IS_TEST is set on a production-like deployment', async () => {
    const env = snapshotEnv();
    process.env.IS_TEST = 'true';
    process.env.CONVEX_CLOUD_URL = 'https://prod.example.convex.cloud';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'tickets@example.com';
    try {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({id: 'resend-provider-id'}), {
          status: 200,
          headers: {'content-type': 'application/json'},
        }),
      );
      const t = convexTest();

      await t.action(internal.email.resend_actions.send, {
        to: 'manual-prod@example.com',
        subject: 'Manual production',
        html: '<p>manual production</p>',
        source: 'ticket',
        sourceId: 'manual-prod',
        recipient: 'manual-prod@example.com',
        critical: true,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const captured = await t.query(api.testing.email.getSentEmails, {
        to: 'manual-prod@example.com',
      });
      expect(captured).toHaveLength(0);

      const deliveries = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveries').collect(),
      );
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        source: 'ticket',
        sourceId: 'manual-prod',
        recipient: 'manual-prod@example.com',
        provider: 'resend',
        manual: true,
        fallback: false,
      });
    } finally {
      restoreEnv(env);
    }
  });

  it('records a preview SMTP failure in non-production without Resend config', async () => {
    const env = snapshotEnv();
    process.env.IS_TEST = 'false';
    delete process.env.RESEND_API_KEY;
    delete process.env.CONVEX_CLOUD_URL;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    try {
      const t = convexTest();

      await expect(
        t.action(internal.email.resend_actions.send, {
          to: 'preview@example.com',
          subject: 'Preview',
          html: '<p>preview</p>',
          source: 'auth',
          sourceId: 'preview-failure',
          recipient: 'preview@example.com',
          critical: true,
        }),
      ).rejects.toThrow(/SMTP_USER\/SMTP_PASS/);

      const failures = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        source: 'auth',
        sourceId: 'preview-failure',
        recipient: 'preview@example.com',
      });
      expect(failures[0].error).toContain('Preview SMTP failed');
    } finally {
      restoreEnv(env);
    }
  });

  it('records a config failure without SMTP fallback when production Resend config is missing', async () => {
    const env = snapshotEnv();
    process.env.IS_TEST = 'false';
    process.env.CONVEX_CLOUD_URL = 'https://prod.example.convex.cloud';
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_USER = 'fallback@example.com';
    process.env.SMTP_PASS = 'fallback-password';
    try {
      const t = convexTest();

      await expect(
        t.action(internal.email.resend_actions.send, {
          to: 'critical@example.com',
          subject: 'Critical',
          html: '<p>critical</p>',
          source: 'auth',
          sourceId: 'missing-resend-config',
          recipient: 'critical@example.com',
          critical: true,
        }),
      ).rejects.toThrow(/missing RESEND_API_KEY/);

      const failures = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        source: 'auth',
        sourceId: 'missing-resend-config',
        recipient: 'critical@example.com',
        error: 'Email delivery is not configured (missing RESEND_API_KEY)',
      });
    } finally {
      restoreEnv(env);
    }
  });

  it('records a config failure before consulting an open circuit', async () => {
    const env = snapshotEnv();
    process.env.IS_TEST = 'false';
    process.env.CONVEX_CLOUD_URL = 'https://prod.example.convex.cloud';
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_USER = 'fallback@example.com';
    process.env.SMTP_PASS = 'fallback-password';
    try {
      const t = convexTest();
      await t.run(async (ctx) => {
        await ctx.db.insert('emailProviderCircuit', {
          provider: 'resend',
          failureCount: 3,
          windowStartedAt: Date.now(),
          updatedAt: Date.now(),
          openUntil: Date.now() + 60_000,
        });
      });

      await expect(
        t.action(internal.email.resend_actions.send, {
          to: 'critical@example.com',
          subject: 'Critical',
          html: '<p>critical</p>',
          source: 'auth',
          sourceId: 'open-circuit-missing-resend-config',
          recipient: 'critical@example.com',
          critical: true,
        }),
      ).rejects.toThrow(/missing RESEND_API_KEY/);

      const failures = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        source: 'auth',
        sourceId: 'open-circuit-missing-resend-config',
        recipient: 'critical@example.com',
        error: 'Email delivery is not configured (missing RESEND_API_KEY)',
      });
    } finally {
      restoreEnv(env);
    }
  });

  it('records a missing sender config failure before open-circuit fallback', async () => {
    const env = snapshotEnv();
    process.env.IS_TEST = 'false';
    process.env.CONVEX_CLOUD_URL = 'https://prod.example.convex.cloud';
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.EMAIL_FROM;
    delete process.env.SMTP_FROM;
    process.env.SMTP_USER = 'fallback@example.com';
    process.env.SMTP_PASS = 'fallback-password';
    try {
      const t = convexTest();
      await t.run(async (ctx) => {
        await ctx.db.insert('emailProviderCircuit', {
          provider: 'resend',
          failureCount: 3,
          windowStartedAt: Date.now(),
          updatedAt: Date.now(),
          openUntil: Date.now() + 60_000,
        });
      });

      await expect(
        t.action(internal.email.resend_actions.send, {
          to: 'critical@example.com',
          subject: 'Critical',
          html: '<p>critical</p>',
          source: 'auth',
          sourceId: 'open-circuit-missing-sender-config',
          recipient: 'critical@example.com',
          critical: true,
        }),
      ).rejects.toThrow(/missing EMAIL_FROM/);

      const failures = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        source: 'auth',
        sourceId: 'open-circuit-missing-sender-config',
        recipient: 'critical@example.com',
        error: 'Email delivery is not configured (missing EMAIL_FROM)',
      });
    } finally {
      restoreEnv(env);
    }
  });

  it('records a delivery failure when fallback SMTP fails after a Resend transient failure', async () => {
    const env = snapshotEnv();
    process.env.IS_TEST = 'false';
    process.env.CONVEX_CLOUD_URL = 'https://prod.example.convex.cloud';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'tickets@example.com';
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({message: 'provider unavailable'}), {
          status: 500,
          headers: {'content-type': 'application/json'},
        }),
      );
      const t = convexTest();

      await expect(
        t.action(internal.email.resend_actions.send, {
          to: 'critical@example.com',
          subject: 'Critical',
          html: '<p>critical</p>',
          source: 'auth',
          sourceId: 'transient-fallback-failure',
          recipient: 'critical@example.com',
          critical: true,
        }),
      ).rejects.toThrow(/SMTP_USER\/SMTP_PASS/);

      const failures = await t.run(async (ctx) =>
        ctx.db.query('emailDeliveryFailures').collect(),
      );
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({
        source: 'auth',
        sourceId: 'transient-fallback-failure',
        recipient: 'critical@example.com',
      });
      expect(failures[0].error).toContain('Fallback SMTP failed');
    } finally {
      restoreEnv(env);
    }
  });

  it('bridges terminal Resend provider events into emailDeliveryFailures', async () => {
    const t = convexTest();

    await t.run(async (ctx) => {
      await ctx.db.insert('emailDeliveries', {
        emailId: 'component-email-id',
        resendId: 'resend-email-id',
        source: 'ticket',
        sourceId: 'order-123',
        recipient: 'buyer@example.com',
        critical: true,
        manual: true,
        fallback: false,
        provider: 'resend',
        sentAt: Date.now(),
      });
    });

    // The Resend component invokes `handleEmailEvent` (wired via
    // `lib/resend_component.ts` `onEmailEvent`) for every event it processes,
    // passing the component's internal `id` (matches `emailDeliveries.emailId`)
    // and the raw provider `event` payload.
    await t.mutation(internal.email.resend.handleEmailEvent, {
      id: 'component-email-id',
      event: {
        type: 'email.bounced',
        created_at: new Date().toISOString(),
        data: {
          created_at: new Date().toISOString(),
          email_id: 'resend-email-id',
          from: 'tickets@braket.gay',
          to: 'buyer@example.com',
          subject: 'Ticket',
          bounce: {
            type: 'hard',
            subType: 'general',
            message: 'mailbox unavailable',
          },
        },
      },
    });

    const failures = await t.run(async (ctx) =>
      ctx.db.query('emailDeliveryFailures').collect(),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      source: 'ticket',
      sourceId: 'order-123',
      recipient: 'buyer@example.com',
      error: 'mailbox unavailable',
    });
  });
});
