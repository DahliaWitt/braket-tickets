import {Resend, type ResendOptions} from '@convex-dev/resend';
import {components, internal} from '../_generated/api';

// The component brands EmailId in its callback type, while generated Convex
// references expose validator-branded strings as plain strings.
const onEmailEvent = internal.email.resend.handleEmailEvent as NonNullable<
  ResendOptions['onEmailEvent']
>;

export const resend: Resend = new Resend(components.resend, {
  testMode: process.env['RESEND_TEST_MODE'] === 'true',
  onEmailEvent,
});

export function emailFromAddress(): string {
  const from = process.env['EMAIL_FROM'] ?? process.env['SMTP_FROM'];
  if (!from) {
    throw new Error('Email delivery is not configured (missing EMAIL_FROM)');
  }
  return `Braket Tickets <${from}>`;
}

export function emailReplyTo(): string[] | undefined {
  const replyToAddress =
    process.env['EMAIL_REPLY_TO'] ?? process.env['SMTP_REPLY_TO'];
  return replyToAddress ? [replyToAddress] : undefined;
}

export function emailHeadersToArray(
  headers?: Record<string, string>,
): {name: string; value: string}[] | undefined {
  if (!headers) return undefined;
  return Object.entries(headers).map(([name, value]) => ({name, value}));
}
