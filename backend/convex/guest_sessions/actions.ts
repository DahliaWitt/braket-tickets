'use node';

/* eslint-disable @convex-dev/import-wrong-runtime -- Guest-session actions run in the Node runtime and delegate to Node-only implementation helpers. */

import {v} from 'convex/values';

import {action} from '../_generated/server';
import {initiateGuestSessionHandler} from './_impl/actions';

export const initiateGuestSession = action({
  args: {
    email: v.string(),
    eventId: v.optional(v.id('events')),
    existingSessionToken: v.optional(v.string()),
    magicLinkToken: v.optional(v.string()),
  },
  returns: v.object({
    sessionToken: v.string(),
  }),
  handler: initiateGuestSessionHandler,
});
