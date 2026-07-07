/**
 * Migration: Custom Email Templates
 *
 * Sets branded email templates matching the "Pulp" aesthetic.
 */

import {resolveSiteUrl} from '../lib/site_url';
import {EVENT_DATE_TIME_ZONE} from '../lib/timezone';
import {eventStartInstantMs} from '@shared/event-time';

/** Escapes HTML special characters to prevent XSS in email templates. */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Base styles for email-safe CSS (inline everything)
const baseStyles = {
  bgDark: '#0D0A0C',
  bgCard: '#1B171B',
  textLight: '#FAFAFA',
  textMuted: '#B7AFBA',
  textDim: '#928A96',
  accentPink: '#F42A7E',
  accentViolet: '#F42A7E',
  border: '#332A33',
};

function formatEventDateTime(value: string): string {
  const startsAtMs = eventStartInstantMs(value);
  if (startsAtMs === null) return value;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: EVENT_DATE_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(startsAtMs));
}

const vettingSubmissionTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: EVENT_DATE_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function formatVettingSubmissionTime(submittedAt: number): string {
  return vettingSubmissionTimeFormatter.format(new Date(submittedAt));
}

/**
 * Generates the complete HTML email template wrapper
 */
function wrapEmail(
  content: string,
  preheader = '',
  options?: {includeLegacyFooter?: boolean},
): string {
  const APP_NAME = 'Braket Tickets';
  // Use the accent-colored mark, not the white one. Gmail (iOS/Android) dark mode
  // inverts the dark email background to light but never recolors images, so a white
  // logo vanishes on the flipped-light background. Gmail ignores prefers-color-scheme,
  // so a media-query logo swap cannot target it; the purple mark keeps contrast on both.
  const logoSrc = `${resolveSiteUrl()}/braket_purple.png`;
  const safePreheader = escapeHtml(preheader).replaceAll('—', '&mdash;');
  const includeLegacyFooter = options?.includeLegacyFooter ?? true;
  const footerHtml = includeLegacyFooter
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px;">
                  <tr>
                      <td align="center" style="padding-top: 32px;">
                          <p style="margin: 0; font-size: 12px; line-height: 1.6; color: ${baseStyles.textDim}; font-family: 'Space Mono', 'Courier New', monospace; text-transform: uppercase; letter-spacing: 1.5px;">
                              ${APP_NAME}
                          </p>
                          <p style="margin: 8px 0 0 0; font-size: 12px; line-height: 1.5; color: ${baseStyles.textDim};">
                              You got this because you have an account with us. If it looks weird, you can ignore it.
                          </p>
                      </td>
                  </tr>
              </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${APP_NAME}</title>
  <!--[if mso]>
  <noscript>
      <xml>
          <o:OfficeDocumentSettings>
              <o:PixelsPerInch>96</o:PixelsPerInch>
          </o:OfficeDocumentSettings>
      </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
      body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
      body { margin: 0 !important; padding: 0 !important; width: 100% !important; }
      a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
      @media only screen and (max-width: 600px) {
          .email-container { width: 100% !important; }
          .mobile-padding { padding: 20px !important; }
      }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: ${baseStyles.bgDark}; font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  ${safePreheader ? `<div style="display: none; max-height: 0; overflow: hidden;">${safePreheader}</div>` : ''}
  
  <!-- Email Container -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color: ${baseStyles.bgDark};">
      <tr>
          <td align="center" style="padding: 40px 20px;" class="mobile-padding">
              
              <!-- Logo Header -->
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px;">
                  <tr>
                      <td align="center" style="padding-bottom: 32px;">
                          <img src="${logoSrc}" alt="${APP_NAME}" width="64" height="64" style="display: block; margin: 0 auto 16px auto;"/>
                      </td>
                  </tr>
              </table>
              
              <!-- Content Card -->
              <table role="presentation" class="email-container" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 560px; background-color: ${baseStyles.bgCard}; border-radius: 4px; border: 1px solid ${baseStyles.border};">
                  <tr>
                      <td style="padding: 40px 32px;" class="mobile-padding">
                          ${content}
                      </td>
                  </tr>
              </table>
              
              <!-- Footer -->
              ${footerHtml}
              
          </td>
      </tr>
  </table>
</body>
</html>`;
}

/**
 * Generates a styled CTA button
 */
function ctaButton(href: string, text: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
      <tr>
          <td align="center" style="padding: 24px 0;">
              <a href="${escapeHtml(href)}" target="_blank" rel="noopener" style="display: inline-block; padding: 16px 40px; background-color: ${baseStyles.accentPink}; color: ${baseStyles.bgDark}; text-decoration: none; border-radius: 4px; font-weight: 800; font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; font-family: 'Space Mono', 'Courier New', monospace;">
                  ${text}
              </a>
          </td>
      </tr>
  </table>`;
}

function loginSignupUrl(siteUrl: string, returnUrl?: string): string {
  const url = new URL('/login', siteUrl);
  url.searchParams.set('signup', 'true');
  if (returnUrl) {
    url.searchParams.set('returnUrl', returnUrl);
  }
  return url.toString();
}

function communityEventsUrl(siteUrl: string, communityParam?: string): string {
  if (!communityParam) {
    return `${siteUrl}/events`;
  }
  return `${siteUrl}/events?community=${encodeURIComponent(communityParam)}`;
}

function communityAdminEventUrl(
  siteUrl: string,
  eventId: string,
  communityParam: string,
): string {
  return `${siteUrl}/community-admin/events/${encodeURIComponent(eventId)}/manage?community=${encodeURIComponent(communityParam)}`;
}

function buildCodeOfConductEmailBlock(community?: {
  slug?: string;
  hasCodeOfConduct?: boolean;
}): string {
  if (!community?.hasCodeOfConduct || !community.slug) return '';
  const siteUrl = resolveSiteUrl();
  const cocUrl = `${siteUrl}/c/${encodeURIComponent(community.slug)}`;
  return `
      <div style="margin: 24px 0 0 0; padding: 16px 0 0 0; border-top: 1px solid ${baseStyles.border};">
          <p style="margin: 0; font-size: 12px; line-height: 1.6; color: ${baseStyles.textDim};">
              please review the community's
              <a href="${escapeHtml(cocUrl)}" target="_blank" rel="noopener" style="color: ${baseStyles.accentViolet}; text-decoration: underline;">code of conduct</a>
              before the event~ respect the space and each other.
          </p>
      </div>
  `;
}

export function verificationTemplate(
  url: string,
  _token = '',
): {subject: string; html: string; text: string} {
  // URL is expected to be the full verification link.
  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Almost done :3
      </h2>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          One quick check so we know this inbox is yours.
      </p>
      ${ctaButton(url, 'Yep, This Is My Email')}
      <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: ${baseStyles.textDim};">
          If you didn't make an account, you can ignore this.
      </p>
  `;

  return {
    subject: 'Verify your email',
    text: `Almost done :3\n\nOne quick check so we know this inbox is yours: ${url}\n\nIf you didn't make an account, you can ignore this.`,
    html: wrapEmail(content, 'One quick check so we know this inbox is yours.'),
  };
}

export function passwordResetTemplate(url: string): {
  subject: string;
  text: string;
  html: string;
} {
  const APP_NAME = 'Braket Tickets';
  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Password reset time
      </h2>
      <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          No worries, it happens.
      </p>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Passwords wander off sometimes~ this link lets you make a new one and get back in.
      </p>
      ${ctaButton(url, 'Make New Password')}
      <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: ${baseStyles.textDim};">
          If you didn't ask for this, don't click the link. Your password won't change unless you use it.
      </p>
  `;

  return {
    subject: `Password reset link for ${APP_NAME}`,
    text: `Password reset time\n\nNo worries, it happens.\n\nPasswords wander off sometimes~ this link lets you make a new one and get back in: ${url}\n\nIf you didn't ask for this, don't click the link. Your password won't change unless you use it.`,
    html: wrapEmail(content, 'Password reset link for Braket Tickets'),
  };
}

export function emailChangeConfirmationTemplate(
  newEmail: string,
  confirmUrl: string,
): {subject: string; html: string} {
  const APP_NAME = 'Braket Tickets';
  const safeNewEmail = escapeHtml(newEmail);

  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Confirm this email change
      </h2>
      <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          We got a request to change your account email to <strong>${safeNewEmail}</strong>.
      </p>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          If this was you, confirm it below, then check the new inbox.
      </p>
      ${ctaButton(confirmUrl, 'Yep, That Was Me')}
      <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: ${baseStyles.textDim};">
          If this wasn't you, don't click the button. Reset your password when you have a minute.
      </p>
  `;

  return {
    subject: `Confirm your ${APP_NAME} email change`,
    html: wrapEmail(
      content,
      'Confirm this email change from your current inbox',
    ),
  };
}

export function purchasedTicketTemplate(
  event: {title: string; date: string; location?: string},
  buyerName: string,
  qrCodeSource: string,
  isGuest = false,
  community?: {slug?: string; hasCodeOfConduct?: boolean},
): {subject: string; html: string} {
  const dateStr = formatEventDateTime(event.date);

  // Escape user-controlled data to prevent XSS
  const safeTitle = escapeHtml(event.title);
  const safeBuyerName = escapeHtml(buyerName);
  const safeLocation = event.location ? escapeHtml(event.location) : '';
  const safeQrSource = escapeHtml(qrCodeSource);

  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Ticket secured~ (｡•̀ᴗ-)✧
      </h2>
      <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Thanks for your purchase, ${safeBuyerName}.
      </p>
      <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${baseStyles.border}; border-bottom: 1px solid ${baseStyles.border};">
          <p style="margin: 0 0 8px 0; font-size: 11px; color: ${baseStyles.textDim}; font-family: 'Space Mono', 'Courier New', monospace; text-transform: uppercase; letter-spacing: 1.5px;">EVENT DETAILS</p>
          <p style="margin: 0 0 4px 0; font-size: 18px; font-weight: 600; color: ${baseStyles.accentPink};">${safeTitle}</p>
          <p style="margin: 0 0 4px 0; font-size: 16px; color: ${baseStyles.textLight};">${escapeHtml(dateStr)}</p>
          ${safeLocation ? `<p style="margin: 0; font-size: 16px; color: ${baseStyles.textMuted};">${safeLocation}</p>` : ''}
      </div>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Your ticket PDF is attached~ keep the QR code handy for the door.
      </p>

      <div style="text-align: center; margin: 32px 0;">
          <img src="${safeQrSource}" alt="Ticket QR Code" width="200" height="200" style="display: inline-block; border: 4px solid ${baseStyles.textLight}; border-radius: 8px;"/>
      </div>

      <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: ${baseStyles.textDim};">
          See u there &lt;3 have fun, stay safe, look out for each other.
      </p>
      ${buildCodeOfConductEmailBlock(community)}
      ${
        isGuest
          ? `
      <div style="margin: 32px 0 0 0; padding: 20px 0 0 0; border-top: 1px solid ${baseStyles.border};">
          <p style="margin: 0 0 8px 0; font-size: 11px; color: ${baseStyles.textDim}; font-family: 'Space Mono', 'Courier New', monospace; text-transform: uppercase; letter-spacing: 1.5px;">psst~</p>
          <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: ${baseStyles.textMuted};">
              Want to keep your tickets safe? Make an account and they'll be waiting for you next time. (＾▽＾)
          </p>
          ${ctaButton(loginSignupUrl(resolveSiteUrl(), '/tickets'), 'Create Account')}
      </div>
      `
          : ''
      }
  `;

  return {
    subject: `Your ticket for ${safeTitle}`,
    html: wrapEmail(content, `Your ticket for ${safeTitle} is ready.`),
  };
}

export function resaleAvailableTemplate(
  event: {title: string; date: string; location?: string},
  eventId: string,
): {subject: string; html: string} {
  const safeTitle = escapeHtml(event.title);
  const safeLocation = event.location ? escapeHtml(event.location) : '';
  const dateStr = formatEventDateTime(event.date);
  const siteUrl = resolveSiteUrl();
  const eventUrl = `${siteUrl}/events/${eventId}`;

  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Resale ticket available
      </h2>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Heads up~ someone just listed a resale ticket for ${safeTitle}. If you're still looking, take a peek before it disappears. (•̀ᴗ•́ )و
      </p>
      <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${baseStyles.border}; border-bottom: 1px solid ${baseStyles.border};">
          <p style="margin: 0 0 8px 0; font-size: 11px; color: ${baseStyles.textDim}; font-family: 'Space Mono', 'Courier New', monospace; text-transform: uppercase; letter-spacing: 1.5px;">EVENT DETAILS</p>
          <p style="margin: 0 0 4px 0; font-size: 18px; font-weight: 600; color: ${baseStyles.accentPink};">${safeTitle}</p>
          <p style="margin: 0 0 4px 0; font-size: 16px; color: ${baseStyles.textLight};">${escapeHtml(dateStr)}</p>
          ${safeLocation ? `<p style="margin: 0; font-size: 16px; color: ${baseStyles.textMuted};">${safeLocation}</p>` : ''}
      </div>
      ${ctaButton(eventUrl, 'View Resale Tickets')}
  `;

  return {
    subject: `Resale ticket available for ${safeTitle}`,
    html: wrapEmail(content, `Resale ticket available for ${safeTitle}`),
  };
}

function escapeAndFormatMultiline(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br />');
}

export function ticketPurchaseReminderTemplate(args: {
  event: {_id: string; title: string; date: string; location?: string};
  organizer: {id: string; name: string};
  message: string;
  siteUrl: string;
  apiSiteUrl?: string;
  unsubToken: string;
  preferenceCenterUrl: string;
}): {html: string; text: string; headers: Record<string, string>} {
  const {
    event,
    organizer,
    message,
    siteUrl,
    apiSiteUrl = siteUrl,
    unsubToken,
    preferenceCenterUrl,
  } = args;
  const safeTitle = escapeHtml(event.title);
  const safeOrganizerName = escapeHtml(organizer.name);
  const safeLocation = event.location ? escapeHtml(event.location) : '';
  const safeMessage = escapeAndFormatMultiline(message);
  const ticketUrl = `${siteUrl}/events/${event._id}`;
  const unsubUrl = `${apiSiteUrl}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const oneClickUnsubUrl = `${apiSiteUrl}/api/unsubscribe/one-click?token=${encodeURIComponent(unsubToken)}`;
  const listId = `Braket Tickets ${organizer.id} <reminders.${organizer.id}.braket.gay>`;
  const dateStr = formatEventDateTime(event.date);

  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Ticket reminder for ${safeTitle}
      </h2>
      <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          ${safeMessage}
      </p>
      <div style="margin: 24px 0; padding: 20px 0; border-top: 1px solid ${baseStyles.border}; border-bottom: 1px solid ${baseStyles.border};">
          <p style="margin: 0 0 8px 0; font-size: 11px; color: ${baseStyles.textDim}; font-family: 'Space Mono', 'Courier New', monospace; text-transform: uppercase; letter-spacing: 1.5px;">EVENT DETAILS</p>
          <p style="margin: 0 0 4px 0; font-size: 18px; font-weight: 600; color: ${baseStyles.accentPink};">${safeTitle}</p>
          <p style="margin: 0 0 4px 0; font-size: 16px; color: ${baseStyles.textLight};">${escapeHtml(dateStr)}</p>
          ${safeLocation ? `<p style="margin: 0; font-size: 16px; color: ${baseStyles.textMuted};">${safeLocation}</p>` : ''}
      </div>
      ${ctaButton(ticketUrl, 'Get Your Ticket')}

      <hr style="border: none; border-top: 1px solid ${baseStyles.border}; margin: 32px 0 20px;" />

      <p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0 0 8px;
                 font-family: 'Inter', sans-serif;">
        This is a ticket reminder from Braket Tickets on behalf of ${safeOrganizerName}.
      </p>
      <p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0 0 8px;
                 font-family: 'Inter', sans-serif;">
        &copy; ${new Date().getFullYear()} Braket Tickets &middot; Braket LLC, 480A Clementina St, San Francisco, CA 94103
      </p>
      <p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0;
                 font-family: 'Inter', sans-serif;">
        You're receiving this because you're an approved member of ${safeOrganizerName}'s community. &middot;
        <a href="${escapeHtml(unsubUrl)}" style="color: ${baseStyles.accentPink}; text-decoration: underline;">
          Unsubscribe from future emails from ${safeOrganizerName}
        </a>
        &middot;
        <a href="${escapeHtml(preferenceCenterUrl)}" style="color: ${baseStyles.textMuted}; text-decoration: underline;">
          Manage email preferences
        </a>
      </p>
  `;

  const textLines = [
    `Ticket reminder for ${event.title}`,
    `${dateStr}${event.location ? ` · ${event.location}` : ''}`,
    '',
    message,
    '',
    `Get your ticket: ${ticketUrl}`,
    `Unsubscribe from future emails from ${organizer.name}: ${unsubUrl}`,
    `Manage email preferences: ${preferenceCenterUrl}`,
    '',
    `© ${new Date().getFullYear()} Braket Tickets · Braket LLC, 480A Clementina St, San Francisco, CA 94103`,
  ];

  return {
    html: wrapEmail(content, `ticket reminder for ${safeTitle}`, {
      includeLegacyFooter: false,
    }),
    text: textLines.join('\n'),
    headers: {
      'List-ID': listId,
      'List-Unsubscribe': `<${oneClickUnsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export function guestCheckoutResumeTemplate(args: {
  email: string;
  resumeUrl: string;
  eventTitle?: string;
}): {subject: string; html: string} {
  const safeEmail = escapeHtml(args.email);
  const safeEventTitle = args.eventTitle
    ? escapeHtml(args.eventTitle)
    : 'your event';

  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Resume your guest checkout
      </h2>
      <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          We found an active guest checkout for <strong>${safeEmail}</strong>.
      </p>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Use the link below to resume checkout for ${safeEventTitle} on this device.
      </p>
      ${ctaButton(args.resumeUrl, 'Resume Checkout')}
      <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: ${baseStyles.textDim};">
          If you did not start this checkout, you can ignore this email.
      </p>
  `;

  return {
    subject: 'Resume your guest checkout',
    html: wrapEmail(content, 'Resume your guest checkout'),
  };
}

export function applicationApprovedTemplate(
  userName: string,
  communityName = 'Braket Tickets',
  communityParam?: string,
): {
  subject: string;
  html: string;
} {
  const safeName = escapeHtml(userName);
  const eventsUrl = communityEventsUrl(resolveSiteUrl(), communityParam);
  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Approved! \\o/
      </h2>
      <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Hey ${safeName},
      </p>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Approved~ thanks for taking care with the process. (^_^)
      </p>
      ${ctaButton(eventsUrl, 'View Events')}
  `;

  return {
    subject: `You're approved for ${communityName}. Yipee!`,
    html: wrapEmail(content, `You're approved for ${communityName}. Yipee!`),
  };
}

export function applicationRejectedTemplate(
  userName: string,
  reason?: string,
  communityName = 'Braket Tickets',
): {
  subject: string;
  html: string;
} {
  const safeName = escapeHtml(userName);
  const reasonBlock = reason
    ? `<p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Reason: ${escapeHtml(reason)}
      </p>`
    : '';
  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Application status update
      </h2>
      <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Hi ${safeName},
      </p>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Thanks for applying. After review, we're not able to approve your application at this time.
      </p>
      ${reasonBlock}
  `;

  return {
    subject: `Update on your ${communityName} application`,
    html: wrapEmail(content, `Update on your ${communityName} application`),
  };
}

/**
 * Email broadcast to all ticket holders / guests for an event.
 * Renders a plain-text admin message inside the branded wrapper
 * with a "View Event" CTA.
 */
export function eventBroadcastTemplate(args: {
  event: {_id: string; title: string; date: string; location?: string};
  organizer: {id: string; name: string};
  message: string;
  siteUrl: string;
  apiSiteUrl?: string;
  unsubToken: string;
  preferenceCenterUrl: string;
}): {html: string; text: string; headers: Record<string, string>} {
  const {
    event,
    organizer,
    message,
    siteUrl,
    apiSiteUrl = siteUrl,
    unsubToken,
    preferenceCenterUrl,
  } = args;
  const safeTitle = escapeHtml(event.title);
  const safeOrganizerName = escapeHtml(organizer.name);
  const safeLocation = event.location ? escapeHtml(event.location) : null;
  const safeMessage = escapeAndFormatMultiline(message);
  const eventDate = formatEventDateTime(event.date);
  const eventUrl = `${siteUrl}/events/${event._id}`;
  const unsubUrl = `${apiSiteUrl}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const oneClickUnsubUrl = `${apiSiteUrl}/api/unsubscribe/one-click?token=${encodeURIComponent(unsubToken)}`;
  const listId = `Braket Tickets ${organizer.id} <broadcasts.${organizer.id}.braket.gay>`;

  const content = `
    <h1 style="font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; color: ${baseStyles.textLight}; font-size: 24px; line-height: 1.15; margin-bottom: 4px;">
      ${safeTitle}
    </h1>
    <p style="color: ${baseStyles.textMuted}; font-size: 14px; margin-top: 0; margin-bottom: 20px; font-family: 'Space Mono', 'Courier New', monospace;">
      ${escapeHtml(eventDate)}${safeLocation ? ` · ${safeLocation}` : ''}
    </p>
    <div style="color: ${baseStyles.textLight}; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
      ${safeMessage}
    </div>
    ${ctaButton(eventUrl, 'View Event')}

    <hr style="border: none; border-top: 1px solid ${baseStyles.border}; margin: 32px 0 20px;" />

    <p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0 0 8px;
               font-family: 'Inter', sans-serif;">
      This is a broadcast email from Braket Tickets on behalf of ${safeOrganizerName}.
    </p>
    <p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0 0 8px;
               font-family: 'Inter', sans-serif;">
      © 2026 Braket Tickets · Braket LLC, 480A Clementina St, San Francisco, CA 94103
    </p>
    <p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0;
               font-family: 'Inter', sans-serif;">
      You're receiving this because you bought a ticket or were added to the guest list for ${safeTitle}. ·
      <a href="${escapeHtml(unsubUrl)}" style="color: ${baseStyles.accentPink}; text-decoration: underline;">
        Unsubscribe from future emails from ${safeOrganizerName}
      </a>
      ·
      <a href="${escapeHtml(preferenceCenterUrl)}" style="color: ${baseStyles.textMuted}; text-decoration: underline;">
        Manage email preferences
      </a>
    </p>
  `;

  const textLines = [
    `${event.title}`,
    `${eventDate}${event.location ? ` · ${event.location}` : ''}`,
    '',
    message,
    '',
    `View event: ${eventUrl}`,
    `Unsubscribe from future emails from ${organizer.name}: ${unsubUrl}`,
    `Manage email preferences: ${preferenceCenterUrl}`,
    '',
    'Braket LLC, 480A Clementina St, San Francisco, CA 94103',
  ];

  return {
    html: wrapEmail(content, `Update for ${event.title}`, {
      includeLegacyFooter: false,
    }),
    text: textLines.join('\n'),
    headers: {
      'List-ID': listId,
      'List-Unsubscribe': `<${oneClickUnsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export function vettingSubmissionTemplate(
  adminName: string,
  applicantName: string,
  submittedAt: number,
  communityName: string,
  communityParam: string,
): {subject: string; html: string} {
  const safeAdmin = escapeHtml(adminName);
  const safeApplicant = escapeHtml(applicantName);
  const safeCommunity = escapeHtml(communityName);
  const siteUrl = resolveSiteUrl();
  const reviewUrl = communityAdminPendingUrl(siteUrl, communityParam);
  const timeStr = formatVettingSubmissionTime(submittedAt);

  const content = `
    <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
      New app for ${safeCommunity}
    </h2>
    <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
      Hey ${safeAdmin},
    </p>
    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
      <strong style="color: ${baseStyles.textLight};">${safeApplicant}</strong> submitted a vetting app at ${timeStr}. Take a look when you get a chance.
    </p>
    ${ctaButton(reviewUrl, 'Review Application')}
  `;

  return {
    subject: `New vetting app from ${applicantName}`,
    html: wrapEmail(content, `New app for ${communityName}`),
  };
}

export function vettingDigestTemplate(
  adminName: string,
  communityName: string,
  applications: Array<{name: string; submittedAt: number}>,
  communityParam: string,
): {subject: string; html: string} {
  const safeAdmin = escapeHtml(adminName);
  const safeCommunity = escapeHtml(communityName);
  const siteUrl = resolveSiteUrl();
  const reviewUrl = communityAdminPendingUrl(siteUrl, communityParam);
  const count = applications.length;

  const appRows = applications
    .map((app) => {
      const safeName = escapeHtml(app.name);
      const timeStr = formatVettingSubmissionTime(app.submittedAt);
      return `
        <tr>
          <td style="padding: 10px 0; color: ${baseStyles.textLight}; border-bottom: 1px solid ${baseStyles.border};">
            ${safeName}
          </td>
          <td style="padding: 10px 0; color: ${baseStyles.textMuted}; border-bottom: 1px solid ${baseStyles.border}; text-align: right; font-size: 13px;">
            ${timeStr}
          </td>
        </tr>
      `;
    })
    .join('');

  const content = `
    <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
      Vetting digest for ${safeCommunity}
    </h2>
    <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
      Hey ${safeAdmin},
    </p>
    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
      <strong style="color: ${baseStyles.accentPink};">${count} app${count === 1 ? '' : 's'}</strong> came in since the last digest. Review when you have a minute. (｀・ω・´)ゞ
    </p>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
      <thead>
        <tr>
          <th style="text-align: left; padding: 8px 0; font-size: 12px; color: ${baseStyles.textDim}; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid ${baseStyles.border};">
            APPLICANT
          </th>
          <th style="text-align: right; padding: 8px 0; font-size: 12px; color: ${baseStyles.textDim}; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid ${baseStyles.border};">
            SUBMITTED
          </th>
        </tr>
      </thead>
      <tbody>
        ${appRows}
      </tbody>
    </table>
    ${ctaButton(reviewUrl, 'Open Review Queue')}
  `;

  return {
    subject: `${count} vetting app${count === 1 ? '' : 's'} waiting for ${communityName}`,
    html: wrapEmail(content, `Vetting digest for ${communityName}`),
  };
}

function communityAdminPendingUrl(
  siteUrl: string,
  communityParam: string,
): string {
  return `${siteUrl}/community-admin/pending?community=${encodeURIComponent(communityParam)}`;
}

export function adminInviteTemplate(
  communityName: string,
  redeemUrl: string,
  inviterName: string,
): {subject: string; html: string; text: string} {
  const safeName = escapeHtml(communityName);
  const safeInviter = escapeHtml(inviterName);

  const content = `
    <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
        You've been invited to manage ${safeName}
    </h2>
    <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
        ${safeInviter} invited you to help manage <strong style="color: ${baseStyles.textLight};">${safeName}</strong> on Braket Tickets.
    </p>
    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
        You'll be able to review member applications, manage events, and configure vetting.
    </p>
    ${ctaButton(redeemUrl, 'Accept Invitation')}
    <p style="margin: 24px 0 0 0; font-size: 14px; line-height: 1.6; color: ${baseStyles.textDim};">
        This invitation expires in 7 days. If you weren't expecting this, you can ignore it.
    </p>
  `;

  return {
    subject: `You're invited to manage ${communityName} on Braket Tickets`,
    text: `${inviterName} invited you to help manage ${communityName} on Braket Tickets. Accept here: ${redeemUrl}\n\nThis invitation expires in 7 days.`,
    html: wrapEmail(content, `You've been invited to manage ${communityName}`),
  };
}

/**
 * Marketing email announcing a new event to opted-in community members.
 * CAN-SPAM compliant: physical address, marketing disclosure, one-click unsub.
 */
export function eventAnnouncementTemplate(args: {
  delivery: {
    clickUrl: string;
    openPixelUrl: string;
  };
  event: {
    _id: string;
    title: string;
    date: string;
    location?: string;
    description?: string;
  };
  organizer: {id: string; name: string};
  unsubToken: string;
  siteUrl: string;
  apiSiteUrl?: string;
  vettedViaCommunityNames?: string[];
}): {
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
} {
  const {
    delivery,
    event,
    organizer,
    unsubToken,
    siteUrl,
    apiSiteUrl = siteUrl,
    vettedViaCommunityNames,
  } = args;
  const safeTitle = escapeHtml(event.title);
  const safeOrgName = escapeHtml(organizer.name);
  const safeLocation = event.location ? escapeHtml(event.location) : null;
  const eventDate = formatEventDateTime(event.date);
  const safeDesc = event.description
    ? escapeHtml(event.description.slice(0, 300)) +
      (event.description.length > 300 ? '…' : '')
    : null;

  const eventUrl = `${siteUrl}/events/${event._id}`;
  const unsubUrl = `${apiSiteUrl}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
  const oneClickUnsubUrl = `${apiSiteUrl}/api/unsubscribe/one-click?token=${encodeURIComponent(unsubToken)}`;
  const prefsUrl = `${siteUrl}/account#email-preferences`;
  const listId = `Braket Tickets ${organizer.id} <announcements.${organizer.id}.braket.gay>`;

  // Build trust-link attribution text when the recipient arrived via a trusted organizer.
  const communities = vettedViaCommunityNames ?? [];
  let attributionText: string | null = null;
  if (communities.length > 0) {
    let communityList: string;
    if (communities.length === 1) {
      communityList = communities[0];
    } else if (communities.length === 2) {
      communityList = `${communities[0]} and ${communities[1]}`;
    } else {
      const allButLast = communities.slice(0, -1).join(', ');
      communityList = `${allButLast}, and ${communities[communities.length - 1]}`;
    }
    const verb = communities.length === 1 ? 'shares' : 'share';
    attributionText = `You're receiving this because you're a member of ${communityList}, who ${verb} vetting with ${organizer.name}.`;
  }

  const content = `
    <p style="font-size: 11px; font-family: 'Space Mono', monospace;
               color: ${baseStyles.textDim}; text-transform: uppercase;
               letter-spacing: 2px; margin: 0 0 8px;">
      NEW EVENT FROM ${safeOrgName}
    </p>

    <h1 style="font-family: 'Syne', 'Chakra Petch', sans-serif; color: ${baseStyles.textLight};
                font-size: 28px; margin: 0 0 8px; line-height: 1.2;">
      ${safeTitle}
    </h1>

    <p style="color: ${baseStyles.textMuted}; font-size: 14px; margin: 0 0 ${safeDesc ? '20px' : '24px'};
               font-family: 'Space Mono', monospace;">
      ${escapeHtml(eventDate)}${safeLocation ? ` · ${safeLocation}` : ''}
    </p>

    ${
      safeDesc
        ? `<p style="color: ${baseStyles.textLight}; font-size: 15px; line-height: 1.6;
                  margin: 0 0 24px; font-family: 'Inter', sans-serif;">
            ${safeDesc}
          </p>`
        : ''
    }

    ${ctaButton(delivery.clickUrl, 'Get Tickets')}

    <hr style="border: none; border-top: 1px solid ${baseStyles.border}; margin: 32px 0 20px;" />

    ${
      attributionText
        ? `<p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0 0 8px;
               font-family: 'Inter', sans-serif;">
        ${escapeHtml(attributionText)}
      </p>`
        : ''
    }

    <p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0 0 8px;
               font-family: 'Inter', sans-serif;">
      This is a marketing email from Braket Tickets on behalf of ${safeOrgName}.
    </p>
    <p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0 0 8px;
               font-family: 'Inter', sans-serif;">
      © 2026 Braket Tickets · Braket LLC, 480A Clementina St, San Francisco, CA 94103
    </p>
    <p style="color: ${baseStyles.textDim}; font-size: 12px; margin: 0;
               font-family: 'Inter', sans-serif;">
      You're receiving this because you're opted in to event updates from ${safeOrgName}. ·
      <a href="${escapeHtml(unsubUrl)}" style="color: ${baseStyles.accentPink}; text-decoration: underline;">
        Unsubscribe from ${safeOrgName}
      </a>
      ·
      <a href="${escapeHtml(prefsUrl)}" style="color: ${baseStyles.textMuted}; text-decoration: underline;">
        Manage all email preferences
      </a>
    </p>

    <img
      src="${escapeHtml(delivery.openPixelUrl)}"
      alt=""
      width="1"
      height="1"
      style="display: block; width: 1px; height: 1px; opacity: 0; overflow: hidden;"
    />`;

  const textLines = [
    `NEW EVENT FROM ${organizer.name.toUpperCase()}`,
    event.title,
    `${eventDate}${event.location ? ` · ${event.location}` : ''}`,
    event.description
      ? `${event.description.slice(0, 300)}${event.description.length > 300 ? '…' : ''}`
      : null,
    '',
    `Get tickets: ${eventUrl}`,
    attributionText,
    `Unsubscribe from ${organizer.name}: ${unsubUrl}`,
    `Manage all email preferences: ${prefsUrl}`,
    '',
    'Braket LLC, 480A Clementina St, San Francisco, CA 94103',
  ].filter((line): line is string => line !== null);

  return {
    subject: `New event: ${event.title} from ${organizer.name}`,
    text: textLines.join('\n'),
    html: wrapEmail(
      content,
      `New event from ${organizer.name}: ${event.title}`,
      {
        includeLegacyFooter: false,
      },
    ),
    headers: {
      'List-ID': listId,
      'List-Unsubscribe': `<${oneClickUnsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export function payoutSentTemplate(
  organizerName: string,
  amountFormatted: string,
  eventTitle: string,
  eventId: string,
  communityParam: string,
): {subject: string; html: string} {
  const siteUrl = resolveSiteUrl();
  const safeName = escapeHtml(organizerName);
  const safeTitle = escapeHtml(eventTitle);
  const safeAmount = escapeHtml(amountFormatted);
  const eventUrl = communityAdminEventUrl(siteUrl, eventId, communityParam);

  const content = `
      <h2 style="margin: 0 0 16px 0; font-family: 'Syne', 'Chakra Petch', system-ui, sans-serif; font-size: 24px; line-height: 1.15; font-weight: 700; color: ${baseStyles.textLight};">
          Payout sent
      </h2>
      <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          Hey ${safeName},
      </p>
      <p style="margin: 0 0 8px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          We sent <strong style="color: ${baseStyles.textLight};">${safeAmount}</strong> to your bank account
          for <strong style="color: ${baseStyles.textLight};">${safeTitle}</strong>.
      </p>
      <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: ${baseStyles.textMuted};">
          It usually lands in 1-2 business days, depending on your bank.
      </p>
      ${ctaButton(eventUrl, 'View Event')}
      <p style="margin: 24px 0 0 0; font-size: 13px; line-height: 1.5; color: ${baseStyles.textDim};">
          If anything looks off, reply to this email and we'll sort it out~
      </p>
  `;

  return {
    subject: `Payout sent for ${eventTitle}`,
    html: wrapEmail(content, `Payout sent for ${amountFormatted}`),
  };
}
