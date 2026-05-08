import {looksLikeProduction} from './environment';

export type EmailDeliveryMode = 'resend' | 'ethereal';

export function getEmailDeliveryMode(): EmailDeliveryMode {
  return looksLikeProduction() ? 'resend' : 'ethereal';
}

export function isEmailPreviewMode(): boolean {
  return getEmailDeliveryMode() === 'ethereal';
}

export function hasConfiguredEmailDeliveryCredentials(): boolean {
  if (getEmailDeliveryMode() === 'ethereal') {
    return Boolean(process.env['SMTP_USER'] && process.env['SMTP_PASS']);
  }

  return Boolean(
    process.env['RESEND_API_KEY'] &&
    (process.env['EMAIL_FROM'] || process.env['SMTP_FROM']),
  );
}

export function hasConfiguredCriticalEmailCredentials(): boolean {
  if (getEmailDeliveryMode() === 'ethereal') {
    return Boolean(process.env['SMTP_USER'] && process.env['SMTP_PASS']);
  }

  return Boolean(
    process.env['RESEND_API_KEY'] &&
    (process.env['EMAIL_FROM'] || process.env['SMTP_FROM']),
  );
}
