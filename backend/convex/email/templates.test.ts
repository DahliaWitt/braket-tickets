import {afterEach, describe, expect, it} from 'vitest';
import {
  applicationApprovedTemplate,
  eventAnnouncementTemplate,
  eventBroadcastTemplate,
  payoutSentTemplate,
  purchasedTicketTemplate,
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
});
