import {
  customAction,
  customMutation,
  customQuery,
} from 'convex-helpers/server/customFunctions';
import {v} from 'convex/values';
import {action, mutation, query} from '../_generated/server';
import {isTestEnvironment, isUnitTestRuntime} from '../lib/environment';
import {
  rosterStatusValidator,
  ticketStatusValidator,
  tierValidator,
} from '../lib/validators/ticketing';

export {adminAuditLogValidator} from '../lib/admin_audit_log_validators';
export {guestValidator as guestDocValidator} from '../lib/events/validators';

// Wrappers to use for functions that should only be called from tests.
// These check IS_TEST or the process-local VITEST flag.
// isUnitTestRuntime() is safe because VITEST is set by the vitest runner
// and cannot be configured via Convex deployment environment variables.
// This allows sandbox contract tests to set IS_TEST=false (disabling mocked
// Stripe calls in stripe/actions) while still using testing/ helpers for setup.
export const testingQuery = customQuery(query, {
  args: {},
  input: async () => {
    if (!isTestEnvironment() && !isUnitTestRuntime()) {
      throw new Error(
        'Calling a test only function in an unexpected environment',
      );
    }
    return {ctx: {}, args: {}};
  },
});

export const testingMutation = customMutation(mutation, {
  args: {},
  input: async () => {
    if (!isTestEnvironment() && !isUnitTestRuntime()) {
      throw new Error(
        'Calling a test only function in an unexpected environment',
      );
    }
    return {ctx: {}, args: {}};
  },
});

export const testingAction = customAction(action, {
  args: {},
  input: async () => {
    if (!isTestEnvironment() && !isUnitTestRuntime()) {
      throw new Error(
        'Calling a test only function in an unexpected environment',
      );
    }
    return {ctx: {}, args: {}};
  },
});

export const ticketDocValidator = v.object({
  _id: v.id('tickets'),
  _creationTime: v.number(),
  userId: v.optional(v.id('users')),
  eventId: v.id('events'),
  orderId: v.optional(v.id('ticket_orders')),
  guestSessionId: v.optional(v.id('guest_sessions')),
  status: ticketStatusValidator,
  tier: tierValidator,
  qrCode: v.optional(v.string()),
  checkedInAt: v.optional(v.number()),
  checkedInBy: v.optional(v.id('users')),
  rosterAttendeeName: v.optional(v.string()),
  rosterAttendeeNameLower: v.optional(v.string()),
  rosterEmail: v.optional(v.union(v.string(), v.null())),
  rosterEmailLower: v.optional(v.union(v.string(), v.null())),
  rosterCheckedInByName: v.optional(v.union(v.string(), v.null())),
  rosterStatus: rosterStatusValidator,
  rosterIsActive: v.optional(v.boolean()),
  rosterSortKey: v.optional(v.string()),
});

export const seedOrderStatusValidator = v.union(
  v.literal('pending'),
  v.literal('completed'),
  v.literal('refunded'),
);

const betterAuthCookieValidator = v.object({
  name: v.string(),
  value: v.string(),
  domain: v.string(),
  path: v.string(),
  expires: v.number(),
  sameSite: v.optional(
    v.union(v.literal('Strict'), v.literal('Lax'), v.literal('None')),
  ),
  httpOnly: v.boolean(),
  secure: v.boolean(),
});

export const seedUserAndGetTokensResultValidator = v.object({
  token: v.string(),
  refreshToken: v.string(),
  userId: v.id('users'),
  email: v.string(),
  cookies: v.array(betterAuthCookieValidator),
});

export const seedDemoDataValidator = v.object({
  communities: v.object({
    lot45Id: v.id('organizers'),
    sisterCityId: v.id('organizers'),
    midnightSoundId: v.id('organizers'),
    deepEndId: v.id('organizers'),
  }),
  events: v.object({
    concreteWaxId: v.id('events'),
    lowFrequencyId: v.id('events'),
    backyardSessionsId: v.id('events'),
    nightMarketId: v.id('events'),
    springFundraiserId: v.id('events'),
    rooftopListeningId: v.id('events'),
  }),
});
