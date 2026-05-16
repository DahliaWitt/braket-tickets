import {Resend, type ResendOptions} from '@convex-dev/resend';
import {components, internal} from '../_generated/api';
import {env} from '../_generated/server';

// The component brands EmailId in its callback type, while generated Convex
// references expose validator-branded strings as plain strings.
const onEmailEvent = internal.email.resend.handleEmailEvent as NonNullable<
  ResendOptions['onEmailEvent']
>;

export const resend: Resend = new Resend(components.resend, {
  testMode: env.RESEND_TEST_MODE === 'true',
  onEmailEvent,
});

export function emailFromAddress(): string {
  const from = env.EMAIL_FROM ?? env.SMTP_FROM;
  if (!from) {
    throw new Error('Email delivery is not configured (missing EMAIL_FROM)');
  }
  return `Braket Tickets <${from}>`;
}

export function emailReplyTo(): string[] | undefined {
  const replyToAddress = env.EMAIL_REPLY_TO ?? env.SMTP_REPLY_TO;
  return replyToAddress ? [replyToAddress] : undefined;
}

export function emailHeadersToArray(
  headers?: Record<string, string>,
): {name: string; value: string}[] | undefined {
  if (!headers) return undefined;
  return Object.entries(headers).map(([name, value]) => ({name, value}));
}
