import {v, type Infer} from 'convex/values';
import type {Id} from '../_generated/dataModel';
import type {MutationCtx} from '../_generated/server';
import {authz} from '../lib/authz';
import {ADMIN_AUDIT_ACTIONS} from '../lib/admin_audit_actions';
import {seedDemoDataValidator, testingMutation} from './wrappers';
import {
  addSeedMembership,
  addSeedTrustLink,
  insertSeedOrganizer,
} from './communities';
import {insertSeedEvent} from './events';
import {insertSeedOrder} from './orders';
import {insertSeedTicket} from './tickets';
import {insertSeedApplication} from './applications';
import {insertSeedGuest, insertSeedGuestSession} from './guests';
import {
  insertSeedMagicLink,
  insertSeedMagicLinkRedemption,
} from './magic_links';
import {insertSeedResaleListing} from './resale';
import {
  insertSeedAdminInvite,
  insertSeedAuditLog,
  upsertSeedAdminNotificationPreference,
} from './admin';
import {connectedAccountStatusValidator} from '../lib/validators/stripe_connect';

type ConnectedAccountStatus = Infer<typeof connectedAccountStatusValidator>;

export const seedDemoDataArgsValidator = {
  cooperId: v.id('users'),
  kimId: v.id('users'),
  nomiId: v.id('users'),
  barneyId: v.id('users'),
  charlieId: v.id('users'),
  tobiasId: v.id('users'),
  cherylId: v.id('users'),
  // LINT.IfChange
  posterIds: v.optional(
    v.object({
      concreteWax: v.string(),
      lowFrequency: v.string(),
      nightMarket: v.string(),
      springFundraiser: v.string(),
      rooftopListening: v.string(),
    }),
  ),
  // LINT.ThenChange("../../scripts/seed.ts")
  // LINT.IfChange
  logoIds: v.optional(
    v.object({
      lot45: v.id('_storage'),
      sisterCity: v.id('_storage'),
      midnightSound: v.id('_storage'),
    }),
  ),
  // LINT.ThenChange("../../scripts/seed.ts")
  stripeAccountLot45: v.optional(v.string()),
  stripeAccountLot45Status: v.optional(connectedAccountStatusValidator),
  stripeAccountSisterCity: v.optional(v.string()),
  stripeAccountSisterCityStatus: v.optional(connectedAccountStatusValidator),
};

interface SeedDemoDataArgs {
  cooperId: Id<'users'>;
  kimId: Id<'users'>;
  nomiId: Id<'users'>;
  barneyId: Id<'users'>;
  charlieId: Id<'users'>;
  tobiasId: Id<'users'>;
  cherylId: Id<'users'>;
  posterIds?: {
    concreteWax: string;
    lowFrequency: string;
    nightMarket: string;
    springFundraiser: string;
    rooftopListening: string;
  };
  logoIds?: {
    lot45: Id<'_storage'>;
    sisterCity: Id<'_storage'>;
    midnightSound: Id<'_storage'>;
  };
  stripeAccountLot45?: string;
  stripeAccountLot45Status?: ConnectedAccountStatus;
  stripeAccountSisterCity?: string;
  stripeAccountSisterCityStatus?: ConnectedAccountStatus;
}

export async function insertSeedDemoData(
  ctx: MutationCtx,
  args: SeedDemoDataArgs,
): Promise<Infer<typeof seedDemoDataValidator>> {
  const {
    cooperId,
    kimId,
    nomiId,
    barneyId,
    charlieId,
    tobiasId,
    cherylId,
    posterIds,
    logoIds,
    stripeAccountLot45,
    stripeAccountLot45Status,
    stripeAccountSisterCity,
    stripeAccountSisterCityStatus,
  } = args;

  // ── 1. Role assignments ──
  await authz.assignRole(ctx, cooperId, 'root_admin');

  // ── 2. Communities ──
  const lot45Id = await insertSeedOrganizer(ctx, {
    name: 'Anfangszeit',
    slug: 'anfangszeit',
    email: 'anfangszeit@example.com',
    contactInfo:
      'DM @anfangszeit on Instagram for door questions, or email anfangszeit@example.com.',
    description: 'Lorem ipsum this is just some test data lol.',
    stripeConnectedAccountId: stripeAccountLot45,
    stripeOnboardingStatus: stripeAccountLot45
      ? (stripeAccountLot45Status?.onboardingStatus ?? 'complete')
      : undefined,
    stripeChargesEnabled: stripeAccountLot45
      ? (stripeAccountLot45Status?.chargesEnabled ?? true)
      : undefined,
    stripePayoutsEnabled: stripeAccountLot45
      ? (stripeAccountLot45Status?.payoutsEnabled ?? true)
      : undefined,
    stripeCurrentlyDue: stripeAccountLot45Status?.currentlyDue,
    isPublicDirectory: true,
    isPlatformOrganizer: false,
    logoStorageId: logoIds?.lot45,
    status: 'published',
    codeOfConduct:
      'Be cool. Do not be uncool. If you are unsure whether something is cool, it is probably not cool. This code of conduct was written by a seed script and has no legal standing whatsoever.',
    vettingQuestions: [
      {
        id: 'q1',
        question:
          'Who told you about this? Be specific or be vague, we do not care.',
        type: 'text' as const,
        required: true,
      },
      {
        id: 'q2',
        question: 'Pick one. It does not matter which.',
        type: 'select' as const,
        required: true,
        options: ['Option A', 'Option B', 'Option C', 'None of the above'],
      },
      {
        id: 'q3',
        question: 'Why is EDM your favorite kind of music?',
        type: 'long_text' as const,
        required: true,
      },
    ],
  });

  const sisterCityId = await insertSeedOrganizer(ctx, {
    name: 'Sister City',
    slug: 'sister-city',
    email: 'sistercity@example.com',
    contactInfo:
      'Signal preferred. DM @sistercityoakland or email sistercity@example.com.',
    description: 'Lorem ipsum with better speakers.',
    isPublicDirectory: false,
    isPlatformOrganizer: false,
    logoStorageId: logoIds?.sisterCity,
    status: 'published',
    stripeConnectedAccountId: stripeAccountSisterCity,
    stripeOnboardingStatus: stripeAccountSisterCity
      ? (stripeAccountSisterCityStatus?.onboardingStatus ?? 'complete')
      : undefined,
    stripeChargesEnabled: stripeAccountSisterCity
      ? (stripeAccountSisterCityStatus?.chargesEnabled ?? true)
      : undefined,
    stripePayoutsEnabled: stripeAccountSisterCity
      ? (stripeAccountSisterCityStatus?.payoutsEnabled ?? true)
      : undefined,
    stripeCurrentlyDue: stripeAccountSisterCityStatus?.currentlyDue,
    vettingQuestions: [
      {
        id: 'q1',
        question: 'Short text field. Put whatever you want here.',
        type: 'text' as const,
        required: true,
      },
      {
        id: 'q2',
        question:
          'Long text field. Really let it out. This is your moment. Or just type "test" like everyone else.',
        type: 'long_text' as const,
        required: true,
      },
      {
        id: 'q3',
        question: 'Boolean field. Yes or no. The stakes have never been lower.',
        type: 'boolean' as const,
        required: true,
      },
      {
        id: 'q4',
        question:
          'Checkbox field. Select all that apply (or none, we are not your boss).',
        type: 'checkbox' as const,
        required: false,
        options: [
          'Checkbox A',
          'Checkbox B',
          'Checkbox C',
          'All of them',
          'None of them',
        ],
      },
    ],
  });

  const midnightSoundId = await insertSeedOrganizer(ctx, {
    name: 'Midnight Sound (no stripe connect)',
    slug: 'midnight-sound',
    email: 'midnightsound@example.com',
    contactInfo:
      'Email midnightsound@example.com or DM @midnightsound.sf for rooftop details.',
    isPublicDirectory: true,
    // Rooftop Listening is the seed fixture's public paid checkout path.
    // Mark this as platform-backed so local QA can complete checkout without
    // requiring another Stripe Connect seed account.
    isPlatformOrganizer: true,
    logoStorageId: logoIds?.midnightSound,
    status: 'published',
    vettingQuestions: [
      {
        id: 'q1',
        question: 'What is your name and/or alias?',
        type: 'text' as const,
        required: true,
      },
      {
        id: 'q2',
        question:
          'Write a short essay about why you are filling out this form. Minimum effort appreciated.',
        type: 'long_text' as const,
        required: true,
      },
      {
        id: 'q3',
        question:
          'Do you acknowledge that this is seed data and none of this is real?',
        type: 'boolean' as const,
        required: true,
      },
    ],
  });

  const deepEndId = await insertSeedOrganizer(ctx, {
    name: 'Deep End Collective',
    slug: 'deep-end',
    email: 'deepend@example.com',
    contactInfo: 'Launching soon. Email deepend@example.com for updates.',
    description: 'Still getting set up. Launching soon.',
    status: 'draft',
  });

  // ── 3. Community roles ──
  await authz.assignRole(ctx, kimId, 'community_admin', {
    type: 'organizer',
    id: lot45Id as string,
  });
  await addSeedMembership(ctx, kimId, lot45Id);

  await authz.assignRole(ctx, nomiId, 'community_admin', {
    type: 'organizer',
    id: sisterCityId as string,
  });
  await addSeedMembership(ctx, nomiId, sisterCityId);
  await authz.assignRole(ctx, nomiId, 'community_scanner', {
    type: 'organizer',
    id: sisterCityId as string,
  });
  await addSeedMembership(ctx, nomiId, sisterCityId);

  await authz.assignRole(ctx, barneyId, 'community_scanner', {
    type: 'organizer',
    id: lot45Id as string,
  });
  await addSeedMembership(ctx, barneyId, lot45Id);

  await authz.assignRole(ctx, cherylId, 'community_admin', {
    type: 'organizer',
    id: deepEndId as string,
  });
  await addSeedMembership(ctx, cherylId, deepEndId);

  // ── 4. Trust links ──
  // Keep one outbound link visible for the default Anfangszeit admin path so the
  // Shared Vetting removal flow is available after a fresh local seed.
  await addSeedTrustLink(ctx, lot45Id, sisterCityId);
  await addSeedTrustLink(ctx, sisterCityId, lot45Id);

  // ── 5. Events ──
  const futureDate = '2026-05-15';
  const pastDate = '2026-02-20';

  const concreteWaxId = await insertSeedEvent(ctx, {
    title: 'Concrete & Wax',
    description:
      'Lorem ipsum but on vinyl. No one has ever described an event this poorly, and yet here we are. The vibe is whatever you want it to be. We are not responsible for the vibe.\n\nThis is placeholder text. If this copy ships to production, fuck...',
    date: futureDate,
    location: 'A location, probably. Do not actually go here.',
    price: 2500,
    totalTickets: 100,
    soldCount: 59,
    status: 'published',
    visibility: 'public_viewable',
    organizerId: lot45Id,
    slidingScaleEnabled: true,
    slidingScaleMin: 1500,
    slidingScaleMax: 4000,
    resaleEnabled: true,
    resaleFeePct: 5,
    poster: posterIds?.concreteWax,
  });

  // Low Frequency: ended event with past date — used by visual audit to show
  // meaningful SALES PER DAY and check-in chart data on the Event Management page.
  // soldCount is set to 44 so that after the 5 real seed tickets (charlie, cooper, nomi,
  // barney, kim) increment event_inventory.soldCount, the final tally is 49/50 —
  // near-capacity without exceeding it. (44 + 5 real tickets = 49.)
  const lowFrequencyDate = '2026-01-10';
  const lowFrequencyId = await insertSeedEvent(ctx, {
    title: 'Low Frequency',
    description:
      'Lorem ipsum but with more bass. If you can read this, the subwoofer is not loud enough. Turn it up. No, more. Keep going.\n\nThis event description was written by a seed script at 2am and it shows. You are welcome.',
    date: lowFrequencyDate,
    location: 'Somewhere with low ceilings and loud speakers',
    price: 1500,
    totalTickets: 50,
    soldCount: 44,
    status: 'published',
    visibility: 'public_viewable',
    organizerId: lot45Id,
    ticketSalesStatus: 'ended',
    resaleEnabled: true,
    resaleFeePct: 10,
    paidOutAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
    poster: posterIds?.lowFrequency,
  });

  await insertSeedEvent(ctx, {
    title: 'Untitled March Show',
    date: futureDate,
    price: 2000,
    totalTickets: 80,
    soldCount: 0,
    status: 'published',
    visibility: 'private',
    organizerId: lot45Id,
    ticketSalesStatus: 'paused',
    location: 'A location, probably. Do not actually go here.',
  });

  const backyardSessionsId = await insertSeedEvent(ctx, {
    title: 'Backyard Sessions',
    date: futureDate,
    location: 'Sister City Backyard, Oakland CA',
    price: 0,
    totalTickets: 40,
    soldCount: 24,
    status: 'published',
    visibility: 'public',
    organizerId: sisterCityId,
    maxTicketsPerUser: 2,
  });

  const nightMarketId = await insertSeedEvent(ctx, {
    title: 'Night Market',
    description:
      'There will be food, probably. There will be music, definitely. There will be this description, unfortunately.\n\nWe wanted to write something compelling here but the budget ran out. Pretend this is two paragraphs of gorgeous event copy.',
    date: futureDate,
    location: 'Sister City Warehouse, Oakland CA',
    price: 3500,
    totalTickets: 120,
    soldCount: 84,
    status: 'published',
    visibility: 'private',
    organizerId: sisterCityId,
    supporterDefaultPrice: 5000,
    poster: posterIds?.nightMarket,
  });

  const springFundraiserId = await insertSeedEvent(ctx, {
    title: 'Spring Fundraiser',
    description:
      'This is a fundraiser. We need money for things. The things are important but we cannot tell you what they are because this is placeholder text.\n\nIf you are reading this description on a real website, something has gone wrong. Please bring snacks.',
    date: pastDate,
    location: 'Sister City Main Hall, Oakland CA',
    price: 3000,
    totalTickets: 60,
    soldCount: 15,
    status: 'cancelled',
    visibility: 'private',
    organizerId: sisterCityId,
    poster: posterIds?.springFundraiser,
  });

  const rooftopListeningId = await insertSeedEvent(ctx, {
    title: 'Rooftop Listening',
    description:
      'Imagine a rooftop. Now imagine music on that rooftop. You have just imagined this event. Congratulations, you are now a promoter.\n\nThis description is a placeholder and will be replaced by someone with actual taste. Probably.',
    date: futureDate,
    location: 'Midnight Sound Rooftop, San Francisco CA',
    price: 2000,
    totalTickets: 30,
    soldCount: 11,
    status: 'published',
    visibility: 'public',
    organizerId: midnightSoundId,
    resaleEnabled: true,
    resaleFeePct: 5,
    poster: posterIds?.rooftopListening,
  });

  await insertSeedEvent(ctx, {
    title: 'TBD',
    date: futureDate,
    price: 0,
    totalTickets: 100,
    soldCount: 0,
    status: 'draft',
    visibility: 'private',
    organizerId: midnightSoundId,
  });

  // ── 6. Orders ──
  const {orderId: charlieConcreteOrder} = await insertSeedOrder(ctx, {
    userId: charlieId,
    eventId: concreteWaxId,
    amount: 2500,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'direct',
  });

  const {orderId: charlieLowFreqOrder} = await insertSeedOrder(ctx, {
    userId: charlieId,
    eventId: lowFrequencyId,
    amount: 1500,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'direct',
  });

  // Additional Low Frequency sales — gives the Event Management page meaningful
  // SALES PER DAY chart data and check-in stats for the visual audit.
  const {orderId: cooperLowFreqOrder} = await insertSeedOrder(ctx, {
    userId: cooperId,
    eventId: lowFrequencyId,
    amount: 1500,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'direct',
  });

  const {orderId: nomiLowFreqOrder} = await insertSeedOrder(ctx, {
    userId: nomiId,
    eventId: lowFrequencyId,
    amount: 1500,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'direct',
  });

  const {orderId: barneyLowFreqOrder} = await insertSeedOrder(ctx, {
    userId: barneyId,
    eventId: lowFrequencyId,
    amount: 1500,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'direct',
  });

  const {orderId: kimLowFreqOrder} = await insertSeedOrder(ctx, {
    userId: kimId,
    eventId: lowFrequencyId,
    amount: 1500,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'direct',
  });

  const {orderId: charlieNightMarketOrder} = await insertSeedOrder(ctx, {
    userId: charlieId,
    eventId: nightMarketId,
    amount: 5000,
    quantity: 1,
    status: 'completed',
    tier: 'supporter',
    trustSource: 'direct',
  });

  const {orderId: charlieSpringOrder} = await insertSeedOrder(ctx, {
    userId: charlieId,
    eventId: springFundraiserId,
    amount: 3000,
    quantity: 1,
    status: 'refunded',
    tier: 'regular',
    trustSource: 'direct',
  });

  const {orderId: tobiasBackyardOrder} = await insertSeedOrder(ctx, {
    userId: tobiasId,
    eventId: backyardSessionsId,
    amount: 0,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'open_access',
  });

  const {orderId: kimRooftopOrder} = await insertSeedOrder(ctx, {
    userId: kimId,
    eventId: rooftopListeningId,
    amount: 2000,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'open_access',
  });

  // Pending order — mid-checkout (no ticket created)
  await insertSeedOrder(ctx, {
    userId: charlieId,
    eventId: concreteWaxId,
    amount: 2500,
    quantity: 1,
    status: 'pending',
    tier: 'regular',
    trustSource: 'direct',
  });

  // Barney buys Night Market via shared trust (Anfangszeit member → Sister City trusts Anfangszeit)
  const {orderId: barneyNightMarketOrder} = await insertSeedOrder(ctx, {
    userId: barneyId,
    eventId: nightMarketId,
    amount: 3500,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'shared',
    trustViaOrganizerId: lot45Id,
  });

  // Cheryl's expired ticket for Rooftop Listening
  const {orderId: cherylRooftopOrder} = await insertSeedOrder(ctx, {
    userId: cherylId,
    eventId: rooftopListeningId,
    amount: 2000,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    trustSource: 'open_access',
  });

  // NOTAFLOF tier coverage — Charlie buys a NOTAFLOF ticket for Concrete & Wax
  const {orderId: charlieConcreteNotaflofOrder} = await insertSeedOrder(ctx, {
    userId: charlieId,
    eventId: concreteWaxId,
    amount: 1800,
    quantity: 1,
    status: 'completed',
    tier: 'notaflof',
    trustSource: 'direct',
  });

  // ── 7. Tickets ──
  await insertSeedTicket(ctx, {
    userId: charlieId,
    eventId: lowFrequencyId,
    orderId: charlieLowFreqOrder,
    status: 'used',
    tier: 'regular',
    checkedInAt: Date.now() - 2 * 60 * 60 * 1000, // checked in 2h ago
    checkedInBy: barneyId,
  });

  // Additional Low Frequency tickets with check-ins for chart data
  await insertSeedTicket(ctx, {
    userId: cooperId,
    eventId: lowFrequencyId,
    orderId: cooperLowFreqOrder,
    status: 'used',
    tier: 'regular',
    checkedInAt: Date.now() - 90 * 60 * 1000, // checked in 90min ago
    checkedInBy: barneyId,
  });

  await insertSeedTicket(ctx, {
    userId: nomiId,
    eventId: lowFrequencyId,
    orderId: nomiLowFreqOrder,
    status: 'used',
    tier: 'regular',
    checkedInAt: Date.now() - 60 * 60 * 1000, // checked in 1h ago
    checkedInBy: barneyId,
  });

  // Barney's Low Frequency ticket — valid (not checked in), used for resale listing
  const barneyLowFreqTicket = await insertSeedTicket(ctx, {
    userId: barneyId,
    eventId: lowFrequencyId,
    orderId: barneyLowFreqOrder,
    status: 'valid',
    tier: 'regular',
  });

  await insertSeedTicket(ctx, {
    userId: kimId,
    eventId: lowFrequencyId,
    orderId: kimLowFreqOrder,
    status: 'used',
    tier: 'regular',
    checkedInAt: Date.now() - 30 * 60 * 1000, // checked in 30min ago
    checkedInBy: barneyId,
  });

  await insertSeedTicket(ctx, {
    userId: charlieId,
    eventId: concreteWaxId,
    orderId: charlieConcreteOrder,
    status: 'valid',
    tier: 'regular',
  });

  await insertSeedTicket(ctx, {
    userId: charlieId,
    eventId: nightMarketId,
    orderId: charlieNightMarketOrder,
    status: 'valid',
    tier: 'supporter',
  });

  await insertSeedTicket(ctx, {
    userId: charlieId,
    eventId: springFundraiserId,
    orderId: charlieSpringOrder,
    status: 'refunded',
    tier: 'regular',
  });

  await insertSeedTicket(ctx, {
    userId: tobiasId,
    eventId: backyardSessionsId,
    orderId: tobiasBackyardOrder,
    status: 'valid',
    tier: 'regular',
  });

  const kimRooftopTicket = await insertSeedTicket(ctx, {
    userId: kimId,
    eventId: rooftopListeningId,
    orderId: kimRooftopOrder,
    status: 'used',
    tier: 'regular',
    checkedInAt: Date.now(),
    checkedInBy: kimId,
  });

  // NOTAFLOF ticket for Charlie on Concrete & Wax
  await insertSeedTicket(ctx, {
    userId: charlieId,
    eventId: concreteWaxId,
    orderId: charlieConcreteNotaflofOrder,
    status: 'valid',
    tier: 'notaflof',
  });

  // Barney's Night Market ticket via shared trust
  await insertSeedTicket(ctx, {
    userId: barneyId,
    eventId: nightMarketId,
    orderId: barneyNightMarketOrder,
    status: 'valid',
    tier: 'regular',
  });

  // Cheryl's expired ticket for Rooftop Listening
  await insertSeedTicket(ctx, {
    userId: cherylId,
    eventId: rooftopListeningId,
    orderId: cherylRooftopOrder,
    status: 'expired',
    tier: 'regular',
  });

  // ── 8. Applications ──
  await insertSeedApplication(ctx, {
    userId: charlieId,
    organizerId: sisterCityId,
    status: 'approved',
    answers: {
      q1: 'test',
      q2: 'I am typing words into a long text field. These are the words. There are many like them but these are mine.',
      q3: true,
    },
  });

  await insertSeedApplication(ctx, {
    userId: tobiasId,
    organizerId: sisterCityId,
    status: 'pending',
    answers: {
      q1: 'asdf',
      q2: 'Just checking if this works tbh.',
      q3: true,
    },
  });

  const nomiLot45ApplicationId = await insertSeedApplication(ctx, {
    userId: nomiId,
    organizerId: lot45Id,
    status: 'approved',
    answers: {
      q1: 'A little bird told me',
      q2: 'Option B',
      q3: 'It is not. This question is a trap and I refuse to engage further.',
    },
  });

  await insertSeedApplication(ctx, {
    userId: tobiasId,
    organizerId: lot45Id,
    status: 'rejected',
    reason: 'Incomplete answers',
    answers: {
      q1: 'idk google',
    },
  });

  await insertSeedApplication(ctx, {
    userId: charlieId,
    organizerId: midnightSoundId,
    status: 'revoked',
    reason: 'Violated the seed data code of conduct (not a real reason)',
    answers: {
      q1: 'Charlie Kelly',
      q2: 'I have a lot of feelings about this form and I am expressing them here in long text format.',
      q3: true,
    },
  });

  // ── 9. Guests (event door guests) ──
  await insertSeedGuest(ctx, {
    eventId: concreteWaxId,
    name: 'Devon Harris',
    type: 'guest',
  });

  await insertSeedGuest(ctx, {
    eventId: concreteWaxId,
    name: 'Ayumi Sato',
    type: 'artist guest',
    checkedInAt: Date.now(),
    checkedInBy: barneyId,
  });

  await insertSeedGuest(ctx, {
    eventId: nightMarketId,
    name: 'Rene Dubois',
    type: 'staff',
  });

  await insertSeedGuest(ctx, {
    eventId: backyardSessionsId,
    name: 'Tomas Reyes',
    type: 'guest',
    checkedInAt: Date.now(),
    checkedInBy: nomiId,
  });

  // ── 10. Magic links ──
  const {linkId: friendsLink} = await insertSeedMagicLink(ctx.db, {
    createdBy: kimId,
    organizerId: lot45Id,
    status: 'active',
    label: 'Friends of Anfangszeit',
    token: 'demo-friends-anfangszeit',
  });

  await insertSeedMagicLink(ctx.db, {
    createdBy: nomiId,
    organizerId: sisterCityId,
    status: 'paused',
    label: 'Spring Invite',
    token: 'demo-spring-invite',
  });

  const {linkId: oldLink} = await insertSeedMagicLink(ctx.db, {
    createdBy: kimId,
    organizerId: lot45Id,
    status: 'disabled',
    label: 'Old Link',
    token: 'demo-old-link',
    expiresAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
  });

  // Magic link redemptions
  await insertSeedMagicLinkRedemption(ctx, {
    magicLinkId: friendsLink,
    userId: charlieId,
    redeemedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
  });

  const guestSession1 = await insertSeedGuestSession(ctx, {
    email: 'guest1@example.com',
    magicLinkId: friendsLink,
    sessionToken: 'demo-guest-session-1',
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });

  const guestSession2 = await insertSeedGuestSession(ctx, {
    email: 'guest2@example.com',
    magicLinkId: friendsLink,
    sessionToken: 'demo-guest-session-2',
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });

  // Guest-only redemptions (no userId) — call insertSeedMagicLinkRedemption
  // which handles the no-userId case correctly (skips derived state sync)
  await insertSeedMagicLinkRedemption(ctx, {
    magicLinkId: friendsLink,
    guestSessionId: guestSession1,
    redeemedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
  });

  await insertSeedMagicLinkRedemption(ctx, {
    magicLinkId: friendsLink,
    guestSessionId: guestSession2,
    redeemedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
  });

  await insertSeedMagicLinkRedemption(ctx, {
    magicLinkId: oldLink,
    userId: charlieId,
    redeemedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
  });

  // ── Guest checkout ticket ──
  const {orderId: guestBackyardOrder} = await insertSeedOrder(ctx, {
    eventId: backyardSessionsId,
    amount: 0,
    quantity: 1,
    status: 'completed',
    tier: 'regular',
    guestSessionId: guestSession1,
    trustSource: 'open_access',
  });

  await insertSeedTicket(ctx, {
    eventId: backyardSessionsId,
    orderId: guestBackyardOrder,
    status: 'valid',
    tier: 'regular',
    guestSessionId: guestSession1,
  });

  // ── 11. Resale listings ──
  await insertSeedResaleListing(ctx, {
    ticketId: barneyLowFreqTicket,
    eventId: lowFrequencyId,
    sellerId: barneyId,
    status: 'listed',
  });

  // Cancelled resale — Kim listed her Rooftop Listening ticket but withdrew
  await insertSeedResaleListing(ctx, {
    ticketId: kimRooftopTicket,
    eventId: rooftopListeningId,
    sellerId: kimId,
    status: 'cancelled',
    cancelledAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
  });

  // ── 12. Admin audit log entries ──
  await insertSeedAuditLog(ctx, {
    adminId: kimId,
    action: ADMIN_AUDIT_ACTIONS.EVENT_UPDATE,
    organizerId: lot45Id,
    eventId: concreteWaxId,
    source: 'community_admin_panel',
  });

  await insertSeedAuditLog(ctx, {
    adminId: nomiId,
    action: ADMIN_AUDIT_ACTIONS.APPLICATION_REVIEW,
    organizerId: lot45Id,
    applicationId: nomiLot45ApplicationId,
    source: 'community_admin_panel',
  });

  await insertSeedAuditLog(ctx, {
    adminId: cooperId,
    action: ADMIN_AUDIT_ACTIONS.TICKET_CHECK_IN,
    organizerId: lot45Id,
    eventId: lowFrequencyId,
    source: 'scanner',
  });

  await insertSeedAuditLog(ctx, {
    adminId: kimId,
    action: ADMIN_AUDIT_ACTIONS.MAGIC_LINK_REDEMPTION,
    organizerId: lot45Id,
    magicLinkId: friendsLink,
    source: 'magic_link',
  });

  await insertSeedAuditLog(ctx, {
    adminId: cooperId,
    action: ADMIN_AUDIT_ACTIONS.COMMUNITY_ADMIN_GRANT,
    organizerId: lot45Id,
    reason: 'Granted community_admin to Nomi for Anfangszeit',
    source: 'root_admin_panel',
  });

  // ── 13. Admin invites ──
  await insertSeedAdminInvite(ctx, {
    email: 'newadmin@example.com',
    organizerId: lot45Id,
    communityName: 'Anfangszeit',
    token: 'demo-admin-invite-anfangszeit',
    invitedBy: cooperId,
    status: 'pending',
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  // Redeemed invite — Nomi was invited to help with Anfangszeit
  await insertSeedAdminInvite(ctx, {
    email: 'nomi@example.com',
    organizerId: lot45Id,
    communityName: 'Anfangszeit',
    token: 'demo-admin-invite-nomi',
    invitedBy: cooperId,
    status: 'redeemed',
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    redeemedBy: nomiId,
    redeemedAt: Date.now() - 14 * 24 * 60 * 60 * 1000,
  });

  // Cancelled invite
  await insertSeedAdminInvite(ctx, {
    email: 'cancelled@example.com',
    organizerId: lot45Id,
    communityName: 'Anfangszeit',
    token: 'demo-admin-invite-cancelled',
    invitedBy: cooperId,
    status: 'cancelled',
    expiresAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
  });

  // ── 14. Admin notification preferences ──
  await upsertSeedAdminNotificationPreference(ctx, {
    userId: kimId,
    organizerId: lot45Id,
    mode: 'digest',
    digestHour: 9,
  });

  // Nomi: 'all' mode notification preference for Sister City
  await upsertSeedAdminNotificationPreference(ctx, {
    userId: nomiId,
    organizerId: sisterCityId,
    mode: 'all',
    digestHour: 9,
  });

  // ── User flags ──
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- No mutation for globalMarketingOptOut — direct user preference toggle
  await ctx.db.patch('users', tobiasId, {globalMarketingOptOut: true});

  // ── 15. Resale notifications ──
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- No composite for resale_notifications — notification subscription with no business logic
  await ctx.db.insert('resale_notifications', {
    userId: tobiasId,
    eventId: lowFrequencyId,
    email: 'tobias@example.com',
  });

  // ── 16. Event broadcasts ──
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- No composite for eventBroadcasts — demo data seed for display only
  await ctx.db.insert('eventBroadcasts', {
    eventId: concreteWaxId,
    adminId: kimId,
    subject: 'Important update for Concrete & Wax',
    message: 'Doors open at 9pm. Bring ID.',
    recipientCount: 59,
    sentAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
  });

  // ── 17. Marketing emails ──
  // eslint-disable-next-line no-raw-db-mutations/no-raw-db-mutation -- No composite for eventMarketingEmails — demo data seed for display only
  await ctx.db.insert('eventMarketingEmails', {
    eventId: concreteWaxId,
    adminId: kimId,
    scheduledFor: Date.now() + 2 * 24 * 60 * 60 * 1000,
    status: 'scheduled',
    audienceScope: 'community',
  });

  // ── Return all created IDs for test consumers ──
  return {
    communities: {
      lot45Id,
      sisterCityId,
      midnightSoundId,
      deepEndId,
    },
    events: {
      concreteWaxId,
      lowFrequencyId,
      backyardSessionsId,
      nightMarketId,
      springFundraiserId,
      rooftopListeningId,
    },
  };
}

export const seedDemoData = testingMutation({
  args: seedDemoDataArgsValidator,
  returns: seedDemoDataValidator,
  handler: insertSeedDemoData,
});
