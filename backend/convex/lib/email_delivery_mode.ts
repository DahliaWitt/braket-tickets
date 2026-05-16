import {looksLikeProduction} from './environment';
import {env} from '../_generated/server';

export type EmailDeliveryMode = 'resend' | 'ethereal';

export function getEmailDeliveryMode(): EmailDeliveryMode {
  return looksLikeProduction() ? 'resend' : 'ethereal';
}

export function isEmailPreviewMode(): boolean {
  return getEmailDeliveryMode() === 'ethereal';
}

export function hasConfiguredEmailDeliveryCredentials(): boolean {
  if (getEmailDeliveryMode() === 'ethereal') {
    return Boolean(env.SMTP_USER && env.SMTP_PASS);
  }

  return Boolean(env.RESEND_API_KEY && (env.EMAIL_FROM || env.SMTP_FROM));
}

export function hasConfiguredCriticalEmailCredentials(): boolean {
  if (getEmailDeliveryMode() === 'ethereal') {
    return Boolean(env.SMTP_USER && env.SMTP_PASS);
  }

  return Boolean(env.RESEND_API_KEY && (env.EMAIL_FROM || env.SMTP_FROM));
}
