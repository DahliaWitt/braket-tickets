import {afterEach, describe, expect, it} from 'vitest';
import {
  applicationApprovedTemplate,
  eventAnnouncementTemplate,
  eventBroadcastTemplate,
  payoutSentTemplate,
  purchasedTicketTemplate,
  refundConfirmationTemplate,
  resaleAvailableTemplate,
  ticketPurchaseReminderTemplate,
  vettingDigestTemplate,
  vettingSubmissionTemplate,
} from './templates';

const baseArgs = {
  delivery: {
    clickUrl: 'https://braket.gay/api/marketing/click?token=click-token',
    openPixelUrl: 'https://braket.gay/api/marketing/open?token=open-token',
  },
  event: {
    _id: 'evt_123',
    title: 'Warehouse Communion',
    date: '2026-05-01T20:00:00.000Z',
    location: 'The Vault',
    description: 'A late set under the strobes.',
  },
  organizer: {
    id: 'org_123',
    name: 'Night Shift',
  },
  siteUrl: 'https://braket.gay',
  unsubToken: 'unsubscribe-token',
} as const;

const originalSiteUrl = process.env.SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.SITE_URL;
  } else {
    process.env.SITE_URL = originalSiteUrl;
  }
});

describe('eventAnnouncementTemplate — trust-link attribution', () => {
  it('includes singular attribution for 1 community in HTML and text', () => {
    const {html, text} = eventAnnouncementTemplate({
      ...baseArgs,
      vettedViaCommunityNames: ['Community B'],
    });

    const expectedHtmlFragment =
      'member of Community B, who shares vetting with Night Shift';
    const expectedTextFragment =
      'member of Community B, who shares vetting with Night Shift';

    expect(html).toContain(expectedHtmlFragment);
    expect(text).toContain(expectedTextFragment);
  });

  it('uses "shares" (singular) for 1 community', () => {
    const {html, text} = eventAnnouncementTemplate({
      ...baseArgs,
      vettedViaCommunityNames: ['Community B'],
    });

    expect(html).toContain('who shares vetting');
    expect(html).not.toContain('who share vetting');
    expect(text).toContain('who shares vetting');
  });

  it('includes plural attribution for 2 communities in HTML and text', () => {
    const {html, text} = eventAnnouncementTemplate({
      ...baseArgs,
      vettedViaCommunityNames: ['Community B', 'Community C'],
    });

    const expectedFragment =
      'member of Community B and Community C, who share vetting with Night Shift';

    expect(html).toContain(expectedFragment);
    expect(text).toContain(expectedFragment);
  });

  it('uses "share" (plural) for 2+ communities', () => {
    const {html, text} = eventAnnouncementTemplate({
      ...baseArgs,
      vettedViaCommunityNames: ['Community B', 'Community C'],
    });

    expect(html).toContain('who share vetting');
    expect(html).not.toContain('who shares vetting');
    expect(text).toContain('who share vetting');
  });

  it('uses Oxford comma for 3+ communities', () => {
    const {html, text} = eventAnnouncementTemplate({
      ...baseArgs,
      vettedViaCommunityNames: ['Community A', 'Community B', 'Community C'],
    });

    const expectedFragment =
      'member of Community A, Community B, and Community C, who share vetting with Night Shift';

    expect(html).toContain(expectedFragment);
    expect(text).toContain(expectedFragment);
  });

  it('shows no attribution when vettedViaCommunityNames is undefined', () => {
    const {html, text} = eventAnnouncementTemplate({
      ...baseArgs,
    });

    expect(html).not.toContain('who shares vetting');
    expect(html).not.toContain('who share vetting');
    expect(text).not.toContain('who shares vetting');
    expect(text).not.toContain('who share vetting');
  });

  it('shows no attribution when vettedViaCommunityNames is empty array', () => {
    const {html, text} = eventAnnouncementTemplate({
      ...baseArgs,
      vettedViaCommunityNames: [],
    });

    expect(html).not.toContain('who shares vetting');
    expect(html).not.toContain('who share vetting');
    expect(text).not.toContain('who shares vetting');
    expect(text).not.toContain('who share vetting');
  });

  it('unsubscribe link still just says Unsubscribe without community name', () => {
    const {html} = eventAnnouncementTemplate({
      ...baseArgs,
      vettedViaCommunityNames: ['Community B'],
    });

    // The unsubscribe link anchor text should say "Unsubscribe from Night Shift"
    // (the organizer), not "Unsubscribe from Community B"
    expect(html).toContain('Unsubscribe from Night Shift');
    expect(html).not.toContain('Unsubscribe from Community B');
  });
});

describe('eventAnnouncementTemplate', () => {
  it('links manage preferences to the account preference center', () => {
    const {headers, html} = eventAnnouncementTemplate({
      delivery: {
        clickUrl: 'https://braket.gay/api/marketing/click?token=click-token',
        openPixelUrl: 'https://braket.gay/api/marketing/open?token=open-token',
      },
      event: {
        _id: 'evt_123',
        title: 'Warehouse Communion',
        date: '2026-05-01T20:00:00.000Z',
        location: 'The Vault',
        description: 'A late set under the strobes.',
      },
      organizer: {
        id: 'org_123',
        name: 'Night Shift',
      },
      siteUrl: 'https://braket.gay',
      unsubToken: 'unsubscribe-token',
    });

    expect(html).toContain('https://braket.gay/account#email-preferences');
    expect(html).toContain('Fri, May 1, 2026, 1:00 PM PDT');
    expect(html).not.toContain('2026-05-01T20:00:00.000Z');
    expect(headers['List-Unsubscribe']).toContain(
      'https://braket.gay/api/unsubscribe/one-click?token=unsubscribe-token',
    );
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(html).not.toContain(
      'u got this email cuz u have an account with us!! if u didnt want it... too bad XD jkjk',
    );
  });

  it('uses the API site URL for unsubscribe links when it differs from the frontend site', () => {
    const {headers, html, text} = eventAnnouncementTemplate({
      ...baseArgs,
      siteUrl: 'http://127.0.0.1:4200',
      apiSiteUrl: 'http://127.0.0.1:3211',
    });

    expect(html).toContain('http://127.0.0.1:4200/account#email-preferences');
    expect(html).toContain(
      'http://127.0.0.1:3211/api/unsubscribe?token=unsubscribe-token',
    );
    expect(text).toContain(
      'Manage all email preferences: http://127.0.0.1:4200/account#email-preferences',
    );
    expect(text).toContain(
      'Unsubscribe from Night Shift: http://127.0.0.1:3211/api/unsubscribe?token=unsubscribe-token',
    );
    expect(headers['List-Unsubscribe']).toContain(
      'http://127.0.0.1:3211/api/unsubscribe/one-click?token=unsubscribe-token',
    );
  });

  it('uses first-party tracking URLs for the CTA and open pixel', () => {
    const clickUrl = 'https://braket.gay/api/marketing/click?token=click-token';
    const openPixelUrl =
      'https://braket.gay/api/marketing/open?token=open-token';

    const {html} = eventAnnouncementTemplate({
      delivery: {clickUrl, openPixelUrl},
      event: {
        _id: 'evt_123',
        title: 'Warehouse Communion',
        date: '2026-05-01T20:00:00.000Z',
      },
      organizer: {
        id: 'org_123',
        name: 'Night Shift',
      },
      siteUrl: 'https://braket.gay',
      unsubToken: 'unsubscribe-token',
    });

    expect(html).toContain(clickUrl);
    expect(html).toContain(openPixelUrl);
    expect(html).not.toContain('https://braket.gay/events/evt_123');
  });
});

describe('purchasedTicketTemplate', () => {
  it('formats event time in the platform Los Angeles timezone', () => {
    const {html} = purchasedTicketTemplate(
      {
        title: 'Late Night Ticket',
        date: '2026-02-27T07:30:00.000Z',
        location: 'Afterhours',
      },
      'Guest',
      'https://qr.example/ticket.png',
      true,
    );

    expect(html).toContain('Thu, Feb 26, 2026, 11:30 PM PST');
    expect(html).not.toContain('Fri, Feb 27');
    expect(html).not.toContain('2026-02-27T07:30:00.000Z');
  });

  it('renders a next-day overnight end as end time only (no end date)', () => {
    const {html} = purchasedTicketTemplate(
      {
        title: 'Overnight Ticket',
        date: '2026-02-27T06:00:00.000Z', // 10pm Feb 26 event-local
        endDate: '2026-02-27T14:00:00.000Z', // 6am Feb 27 event-local
        location: 'Afterhours',
      },
      'Guest',
      'https://qr.example/ticket.png',
      true,
    );

    const normalized = html.replace(/\s+/g, ' ');
    // Start day + time, then just the end time — the next-day date is omitted.
    expect(normalized).toContain('Thu, Feb 26, 2026, 10:00 PM – 6:00 AM PST');
    expect(normalized).not.toContain('Feb 27, 2026');
  });

  it('renders a multi-day event as a full range with both dates', () => {
    const {html} = purchasedTicketTemplate(
      {
        title: 'Weekender Ticket',
        date: '2026-02-27T06:00:00.000Z', // 10pm Feb 26 event-local
        endDate: '2026-03-01T04:00:00.000Z', // 8pm Feb 28 event-local
        location: 'Afterhours',
      },
      'Guest',
      'https://qr.example/ticket.png',
      true,
    );

    const normalized = html.replace(/\s+/g, ' ');
    // Two calendar days apart -> the end date is shown to disambiguate.
    expect(normalized).toContain('Feb 26, 2026');
    expect(normalized).toContain('Feb 28, 2026');
    expect(normalized).toContain('PST');
  });

  it('ignores an end date that is not after the start', () => {
    const {html} = purchasedTicketTemplate(
      {
        title: 'Zero-Length Ticket',
        date: '2026-02-27T07:30:00.000Z',
        endDate: '2026-02-27T07:30:00.000Z',
        location: 'Afterhours',
      },
      'Guest',
      'https://qr.example/ticket.png',
      true,
    );

    expect(html).toContain('Thu, Feb 26, 2026, 11:30 PM PST');
    expect(html.replace(/\s+/g, ' ')).not.toContain('PST – ');
  });

  it('formats legacy date-only event rows as platform-local dates', () => {
    const {html} = purchasedTicketTemplate(
      {
        title: 'Legacy Date Ticket',
        date: '2026-02-27',
        location: 'Afterhours',
      },
      'Guest',
      'https://qr.example/ticket.png',
      true,
    );

    expect(html).toContain('Fri, Feb 27, 2026, 12:00 AM PST');
    expect(html).not.toContain('Thu, Feb 26');
  });

  it('leaves invalid legacy event dates unparsed instead of shifting them', () => {
    const {html} = purchasedTicketTemplate(
      {
        title: 'Invalid Date Ticket',
        date: 'Dec 15, 2030',
      },
      'Guest',
      'https://qr.example/ticket.png',
      true,
    );

    expect(html).toContain('Dec 15, 2030');
  });

  it('links guest ticket recipients to the register tab on the real login route', () => {
    process.env.SITE_URL = 'https://community.braket.gay';

    const {html} = purchasedTicketTemplate(
      {
        title: 'Warehouse Communion',
        date: '2026-05-01T20:00:00.000Z',
      },
      'Guest',
      'https://qr.example/ticket.png',
      true,
    );

    expect(html).toContain(
      'https://community.braket.gay/login?signup=true&amp;returnUrl=%2Ftickets',
    );
    expect(html).not.toContain('/auth/register');
  });

  it('omits the account creation CTA for authenticated purchasers', () => {
    process.env.SITE_URL = 'https://community.braket.gay';

    const {html} = purchasedTicketTemplate(
      {
        title: 'Warehouse Communion',
        date: '2026-05-01T20:00:00.000Z',
      },
      'Authed Buyer',
      'https://qr.example/ticket.png',
    );

    expect(html).not.toContain('Create Account');
    expect(html).not.toContain('login?signup=true');
  });
});

describe('purchasedTicketTemplate — code of conduct', () => {
  it('includes a code of conduct link when community has CoC and slug', () => {
    process.env.SITE_URL = 'https://community.braket.gay';

    const {html} = purchasedTicketTemplate(
      {title: 'Warehouse Communion', date: '2026-05-01T20:00:00.000Z'},
      'Attendee',
      'https://qr.example/ticket.png',
      false,
      {slug: 'test-community', hasCodeOfConduct: true},
    );

    expect(html).toContain('code of conduct');
    expect(html).toContain('https://community.braket.gay/c/test-community');
  });

  it('omits code of conduct block when community has no CoC', () => {
    process.env.SITE_URL = 'https://community.braket.gay';

    const {html} = purchasedTicketTemplate(
      {title: 'Warehouse Communion', date: '2026-05-01T20:00:00.000Z'},
      'Attendee',
      'https://qr.example/ticket.png',
      false,
      {slug: 'test-community', hasCodeOfConduct: false},
    );

    expect(html).not.toContain('code of conduct');
  });

  it('omits code of conduct block when no community info provided', () => {
    const {html} = purchasedTicketTemplate(
      {title: 'Warehouse Communion', date: '2026-05-01T20:00:00.000Z'},
      'Attendee',
      'https://qr.example/ticket.png',
    );

    expect(html).not.toContain('code of conduct');
  });
});

describe('resaleAvailableTemplate', () => {
  it('formats event time in the platform Los Angeles timezone', () => {
    const {html} = resaleAvailableTemplate(
      {
        title: 'Late Night Resale',
        date: '2026-02-27T07:30:00.000Z',
        location: 'Afterhours',
      },
      'evt_late',
    );

    expect(html).toContain('Thu, Feb 26, 2026, 11:30 PM PST');
    expect(html).not.toContain('Fri, Feb 27');
    expect(html).not.toContain('2026-02-27T07:30:00.000Z');
  });
});

describe('ticketPurchaseReminderTemplate', () => {
  it('formats event time in the platform Los Angeles timezone in HTML and text', () => {
    const {html, text} = ticketPurchaseReminderTemplate({
      event: {
        _id: 'evt_late',
        title: 'Late Night Reminder',
        date: '2026-02-27T07:30:00.000Z',
        location: 'Afterhours',
      },
      organizer: {
        id: 'org_late',
        name: 'Night Shift',
      },
      message: 'Tickets are still available.',
      siteUrl: 'https://braket.gay',
      unsubToken: 'reminder-unsub-token',
      preferenceCenterUrl: 'https://braket.gay/account#email-preferences',
    });

    expect(html).toContain('Thu, Feb 26, 2026, 11:30 PM PST');
    expect(text).toContain('Thu, Feb 26, 2026, 11:30 PM PST · Afterhours');
    expect(html).not.toContain('Fri, Feb 27');
    expect(text).not.toContain('Fri, Feb 27');
    expect(html).not.toContain('2026-02-27T07:30:00.000Z');
    expect(text).not.toContain('2026-02-27T07:30:00.000Z');
  });

  it('injects the rich HTML body verbatim and keeps the plain message for the text part', () => {
    const {html, text} = ticketPurchaseReminderTemplate({
      event: {
        _id: 'evt_late',
        title: 'Late Night Reminder',
        date: '2026-02-27T07:30:00.000Z',
        location: 'Afterhours',
      },
      organizer: {id: 'org_late', name: 'Night Shift'},
      message: 'Still available',
      bodyHtml: '<p><strong>Still</strong> available</p>',
      siteUrl: 'https://braket.gay',
      unsubToken: 'reminder-unsub-token',
      preferenceCenterUrl: 'https://braket.gay/account#email-preferences',
    });

    expect(html).toContain('<p><strong>Still</strong> available</p>');
    expect(html).not.toContain('&lt;p&gt;');
    expect(text).toContain('Still available');
  });
});
describe('applicationApprovedTemplate', () => {
  it('links approved applicants to events filtered to their community', () => {
    process.env.SITE_URL = 'https://community.braket.gay';

    const {html} = applicationApprovedTemplate(
      'Applicant',
      'Deep End Collective',
      'deep end',
    );

    expect(html).toContain(
      'https://community.braket.gay/events?community=deep%20end',
    );
  });

  it('falls back to the general events route when no community scope is available', () => {
    process.env.SITE_URL = 'https://community.braket.gay';

    const {html} = applicationApprovedTemplate('Applicant');

    expect(html).toContain('https://community.braket.gay/events');
    expect(html).not.toContain('community=');
  });
});

describe('vettingSubmissionTemplate', () => {
  it('links admins to the community-admin pending queue for the submitted community', () => {
    process.env.SITE_URL = 'https://community.braket.gay';

    const {html} = vettingSubmissionTemplate(
      'Admin',
      'Applicant',
      Date.UTC(2026, 0, 15, 9, 0, 0),
      'Deep End Collective',
      'deep-end',
    );

    expect(html).toContain(
      'https://community.braket.gay/community-admin/pending?community=deep-end',
    );
    expect(html).not.toContain('/admin/applications');
  });

  it('formats submitted time in the platform Los Angeles timezone', () => {
    const {html} = vettingSubmissionTemplate(
      'Admin',
      'Applicant',
      Date.UTC(2026, 4, 12, 0, 30, 0),
      'Deep End Collective',
      'deep-end',
    );

    expect(html).toContain(
      'Applicant</strong> submitted a vetting app at May 11, 5:30 PM.',
    );
    expect(html).not.toContain('May 12, 12:30 AM');
  });
});

describe('vettingDigestTemplate', () => {
  it('links admins to the community-admin pending queue for the digest community', () => {
    process.env.SITE_URL = 'https://community.braket.gay';

    const {html} = vettingDigestTemplate(
      'Admin',
      'Deep End Collective',
      [{name: 'Applicant', submittedAt: Date.UTC(2026, 0, 15, 9, 0, 0)}],
      'deep end',
    );

    expect(html).toContain(
      'https://community.braket.gay/community-admin/pending?community=deep%20end',
    );
    expect(html).not.toContain('/admin/applications');
  });

  it('formats submitted times in the platform Los Angeles timezone', () => {
    const {html} = vettingDigestTemplate(
      'Admin',
      'Deep End Collective',
      [{name: 'Applicant', submittedAt: Date.UTC(2026, 4, 12, 0, 30, 0)}],
      'deep-end',
    );

    expect(html).toContain('May 11, 5:30 PM');
    expect(html).not.toContain('May 12, 12:30 AM');
  });
});

describe('payoutSentTemplate', () => {
  it('keeps payout event links scoped to the paid-out community', () => {
    process.env.SITE_URL = 'https://community.braket.gay';

    const {html} = payoutSentTemplate(
      'Deep End Collective',
      '$123.45',
      'Warehouse Communion',
      'event id',
      'deep end',
    );

    expect(html).toContain(
      'https://community.braket.gay/community-admin/events/event%20id/manage?community=deep%20end',
    );
  });
});

describe('refundConfirmationTemplate', () => {
  const refundEvent = {
    title: 'Warehouse Communion',
    date: '2026-05-01T20:00:00.000Z',
    location: 'The Vault',
  };

  it('renders a complete refund with plural ticket copy, amount, timing, and event identity', () => {
    const {subject, html} = refundConfirmationTemplate({
      event: refundEvent,
      refundedAmountCents: 5000,
      currency: 'USD',
      ticketsRefunded: 2,
      isFullRefund: true,
      supportEmail: 'help@braket.gay',
    });

    expect(subject).toBe('Your refund for Warehouse Communion');
    expect(html).toContain('full refund');
    expect(html).toContain('$50.00 USD');
    expect(html).toContain(
      '2 tickets have been cancelled and can no longer be used for entry.',
    );
    expect(html).toContain('5–10 business days');
    expect(html).toContain('Warehouse Communion');
    expect(html).toContain('The Vault');
    expect(html).toContain('mailto:help@braket.gay');
  });

  it('renders a partial single-ticket refund with singular copy', () => {
    const {subject, html} = refundConfirmationTemplate({
      event: refundEvent,
      refundedAmountCents: 2500,
      currency: 'USD',
      ticketsRefunded: 1,
      isFullRefund: false,
    });

    expect(subject).toBe('Your partial refund for Warehouse Communion');
    expect(html).toContain('partial refund');
    expect(html).toContain('$25.00 USD');
    expect(html).toContain(
      'Your ticket has been cancelled and can no longer be used for entry.',
    );
    expect(html).not.toContain('tickets have been cancelled');
    expect(html).toContain('reply to this email');
  });

  it('renders zero-dollar refunds without money-return or settlement copy', () => {
    const {html} = refundConfirmationTemplate({
      event: refundEvent,
      refundedAmountCents: 0,
      currency: 'USD',
      ticketsRefunded: 1,
      isFullRefund: true,
    });

    expect(html).toContain('free ticket');
    expect(html).toContain('no charge to send back');
    expect(html).not.toContain('5–10 business days');
    expect(html).not.toContain('back to your original payment method');
  });

  it('describes money-only refunds when no tickets were cancelled', () => {
    const {html} = refundConfirmationTemplate({
      event: refundEvent,
      refundedAmountCents: 1000,
      currency: 'USD',
      ticketsRefunded: 0,
      isFullRefund: false,
    });

    expect(html).toContain('No tickets were cancelled for this refund');
    expect(html).toContain('$10.00 USD');
  });

  it('escapes user-controlled event fields', () => {
    const {html} = refundConfirmationTemplate({
      event: {
        title: '<script>alert(1)</script>',
        date: '2026-05-01T20:00:00.000Z',
        location: '<img src=x>',
      },
      refundedAmountCents: 2500,
      currency: 'USD',
      ticketsRefunded: 1,
      isFullRefund: false,
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x>');
  });
});

describe('eventBroadcastTemplate', () => {
  it('includes unsubscribe links, a preference link, and RFC 8058 headers', () => {
    const {html, text, headers} = eventBroadcastTemplate({
      event: {
        _id: 'evt_456',
        title: 'Basement Assembly',
        date: '2026-06-20T21:00:00.000Z',
        location: 'Sublevel',
      },
      organizer: {
        id: 'org_456',
        name: 'Night Signal',
      },
      message: 'Set times moved up by 30 minutes.',
      siteUrl: 'https://braket.gay',
      unsubToken: 'broadcast-unsub-token',
      preferenceCenterUrl: 'https://braket.gay/account#email-preferences',
    });

    expect(html).toContain(
      'https://braket.gay/api/unsubscribe?token=broadcast-unsub-token',
    );
    expect(html).toContain('https://braket.gay/account#email-preferences');
    expect(html).toContain('Sat, Jun 20, 2026, 2:00 PM PDT');
    expect(text).toContain('Sat, Jun 20, 2026, 2:00 PM PDT · Sublevel');
    expect(html).not.toContain('2026-06-20T21:00:00.000Z');
    expect(text).not.toContain('2026-06-20T21:00:00.000Z');
    expect(text).toContain(
      'Unsubscribe from future emails from Night Signal: https://braket.gay/api/unsubscribe?token=broadcast-unsub-token',
    );
    expect(text).toContain(
      'Manage email preferences: https://braket.gay/account#email-preferences',
    );
    expect(headers['List-Unsubscribe']).toContain(
      'https://braket.gay/api/unsubscribe/one-click?token=broadcast-unsub-token',
    );
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(html).not.toContain(
      'u got this email cuz u have an account with us!! if u didnt want it... too bad XD jkjk',
    );
  });

  it('uses the API site URL for unsubscribe links when it differs from the frontend site', () => {
    const {html, text, headers} = eventBroadcastTemplate({
      event: {
        _id: 'evt_456',
        title: 'Basement Assembly',
        date: '2026-06-20T21:00:00.000Z',
        location: 'Sublevel',
      },
      organizer: {
        id: 'org_456',
        name: 'Night Signal',
      },
      message: 'Set times moved up by 30 minutes.',
      siteUrl: 'http://127.0.0.1:4200',
      apiSiteUrl: 'http://127.0.0.1:3211',
      unsubToken: 'broadcast-unsub-token',
      preferenceCenterUrl: 'http://127.0.0.1:4200/account#email-preferences',
    });

    expect(html).toContain(
      'http://127.0.0.1:3211/api/unsubscribe?token=broadcast-unsub-token',
    );
    expect(html).toContain('http://127.0.0.1:4200/account#email-preferences');
    expect(text).toContain(
      'Unsubscribe from future emails from Night Signal: http://127.0.0.1:3211/api/unsubscribe?token=broadcast-unsub-token',
    );
    expect(text).toContain(
      'Manage email preferences: http://127.0.0.1:4200/account#email-preferences',
    );
    expect(headers['List-Unsubscribe']).toContain(
      'http://127.0.0.1:3211/api/unsubscribe/one-click?token=broadcast-unsub-token',
    );
  });

  it('injects the rich HTML body verbatim and keeps the plain message for the text part', () => {
    const {html, text} = eventBroadcastTemplate({
      event: {
        _id: 'evt_456',
        title: 'Basement Assembly',
        date: '2026-06-20T21:00:00.000Z',
        location: 'Sublevel',
      },
      organizer: {id: 'org_456', name: 'Night Signal'},
      message: 'Heading\n\nbody line',
      bodyHtml: '<h2 style="color: #FAFAFA;">Heading</h2><p>body line</p>',
      siteUrl: 'https://braket.gay',
      unsubToken: 'broadcast-unsub-token',
      preferenceCenterUrl: 'https://braket.gay/account#email-preferences',
    });

    // Rich fragment injected as-is (block-level elements survive, unescaped).
    expect(html).toContain('<h2 style="color: #FAFAFA;">Heading</h2>');
    expect(html).toContain('<p>body line</p>');
    expect(html).not.toContain('&lt;h2');
    // Plain-text part still uses the extracted message.
    expect(text).toContain('Heading');
    expect(text).toContain('body line');
  });

  it('escapes the plain message (no rich body) so HTML cannot be injected', () => {
    const {html} = eventBroadcastTemplate({
      event: {
        _id: 'evt_456',
        title: 'Basement Assembly',
        date: '2026-06-20T21:00:00.000Z',
      },
      organizer: {id: 'org_456', name: 'Night Signal'},
      message: '<script>alert(1)</script>',
      siteUrl: 'https://braket.gay',
      unsubToken: 'broadcast-unsub-token',
      preferenceCenterUrl: 'https://braket.gay/account#email-preferences',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('wrapEmail — brand logo', () => {
  it('uses the accent-colored mark so it survives Gmail dark-mode inversion', () => {
    process.env.SITE_URL = 'https://braket.gay';

    const {html} = applicationApprovedTemplate('Alex');

    // The white mark vanishes on Gmail's inverted-light background; the accent
    // mark keeps contrast on both. Guard against silent reversion.
    expect(html).toContain('https://braket.gay/braket_purple.png');
    expect(html).not.toContain('braket_white.png');
  });
});
