/**
 * Application-level rate limiting using @convex-dev/rate-limiter.
 *
 * Protects high-risk endpoints (payments, auth, broadcasts) against
 * brute force, inventory exhaustion, and spam attacks.
 */

import {RateLimiter, MINUTE, HOUR} from '@convex-dev/rate-limiter';
import {components} from '../_generated/api';
import {internalMutation} from '../_generated/server';
import {v} from 'convex/values';
import {getRequestMetadataSafe} from './request_metadata';

export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Order-based hosted checkout flow.
  orderOpen: {kind: 'token bucket', rate: 2, period: MINUTE, capacity: 2},
  orderOpenForGuest: {
    kind: 'token bucket',
    rate: 2,
    period: MINUTE,
    capacity: 2,
  },
  orderOpenResale: {kind: 'token bucket', rate: 2, period: MINUTE, capacity: 2},
  orderClaimFreeTicket: {
    kind: 'token bucket',
    rate: 2,
    period: MINUTE,
    capacity: 2,
  },
  orderClaimFreeTicketForGuest: {
    kind: 'token bucket',
    rate: 2,
    period: MINUTE,
    capacity: 2,
  },
  orderStartCheckout: {kind: 'fixed window', rate: 5, period: MINUTE},
  orderSyncCheckoutSession: {kind: 'fixed window', rate: 10, period: MINUTE},

  // Auth: 3 password changes per user per hour.
  changePassword: {kind: 'fixed window', rate: 3, period: HOUR},

  // Auth: 3 email change requests per user per hour.
  // Allows a normal cancel-and-retry flow without making verification QA wait
  // for the full hourly window.
  requestEmailChange: {kind: 'fixed window', rate: 3, period: HOUR},

  // Auth: 5 email change cancellations per user per hour.
  cancelEmailChange: {kind: 'fixed window', rate: 5, period: HOUR},

  // Auth: social-link attempts are rare and sensitive.
  linkSocialAccount: {kind: 'fixed window', rate: 5, period: HOUR},

  // Auth: unlinking should not be spammed.
  unlinkAccount: {kind: 'fixed window', rate: 10, period: HOUR},

  // Auth: allow a few retries when creating a password for social-only accounts.
  setPassword: {kind: 'fixed window', rate: 3, period: HOUR},

  // Auth: first-time social signup completion should be rare.
  completeSocialSignupOnboarding: {kind: 'fixed window', rate: 5, period: HOUR},

  // Broadcast: 1 per admin per event per 5 minutes.
  broadcastEmail: {kind: 'fixed window', rate: 1, period: 5 * MINUTE},

  // Ticket purchase reminder: 1 per admin per event per 15 minutes.
  // More conservative than broadcasts — these are marketing emails to members
  // who haven't purchased, not operational updates to ticket holders.
  ticketPurchaseReminder: {kind: 'fixed window', rate: 1, period: 15 * MINUTE},

  // Magic link creation: 5 per community admin per minute.
  createMagicLink: {kind: 'fixed window', rate: 5, period: MINUTE},

  // Magic link redemption: 10 per IP per hour.
  // Prevents brute-force token guessing from a single IP.
  redeemMagicLink: {kind: 'fixed window', rate: 10, period: HOUR},

  // Guest session initiation: 3 per email per hour.
  initiateGuestSession: {kind: 'fixed window', rate: 3, period: HOUR},

  // RBAC: community admin grant/revoke — 10 per admin per minute.
  grantCommunityAdmin: {kind: 'fixed window', rate: 10, period: MINUTE},
  revokeCommunityAdmin: {kind: 'fixed window', rate: 10, period: MINUTE},

  // RBAC: community scanner grant/revoke — 20 per admin per minute.
  // Higher limit for bulk door-staff assignment before events.
  grantCommunityScanner: {kind: 'fixed window', rate: 20, period: MINUTE},
  revokeCommunityScanner: {kind: 'fixed window', rate: 20, period: MINUTE},

  // Community settings update: 10 per admin per minute.
  updateOrganizer: {kind: 'fixed window', rate: 10, period: MINUTE},

  // Self-service guest lists: organizer creation/email and delegate CRUD.
  guestListAssignmentCreate: {kind: 'fixed window', rate: 20, period: MINUTE},
  guestListAssignmentBulkCreate: {kind: 'fixed window', rate: 5, period: MINUTE},
  guestListInviteResend: {kind: 'fixed window', rate: 5, period: HOUR},
  guestListTokenResolve: {kind: 'fixed window', rate: 30, period: MINUTE},
  guestListDelegateAdd: {kind: 'fixed window', rate: 20, period: MINUTE},
  guestListDelegateEdit: {kind: 'fixed window', rate: 30, period: MINUTE},
  guestListDelegateRemove: {kind: 'fixed window', rate: 30, period: MINUTE},
  guestListDelegateRetry: {kind: 'fixed window', rate: 5, period: HOUR},

  // Public events landing page: 60 requests per IP per minute.
  // Higher than communities — the landing page hits this on every anonymous page load.
  listPublicEvents: {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 60,
  },

  // Public community directory: 30 requests per IP per minute.
  // Token bucket allows short bursts (e.g. initial page loads) while
  // preventing sustained scraping. CDN caching reduces real-world hits.
  listPublicCommunity: {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 30,
  },

  // Public community by slug: 60 requests per IP per minute.
  // Slightly higher than list — individual slug lookups are common in
  // normal browse/link-sharing flows and hit CDN more often.
  getPublicCommunityBySlug: {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 60,
  },

  // Public single-event preview (OG unfurl): 60 requests per IP per minute.
  // At least as generous as the listing bucket — every preview traffic
  // egresses from Cloudflare Pages Functions and shares one effective IP
  // key, so saturation must degrade gracefully (the worker fails open to
  // the untouched shell rather than surfacing an error to the visitor).
  getPublicEventPreview: {
    kind: 'token bucket',
    rate: 60,
    period: MINUTE,
    capacity: 60,
  },

  // File uploads: 10 upload URL requests per user per minute.
  // Prevents upload URL farming from a single account.
  generateUpload: {kind: 'fixed window', rate: 10, period: MINUTE},

  // File upload confirmation: 10 validations per user per minute.
  // Matches generateUpload cadence — one confirm per upload URL.
  confirmUpload: {kind: 'fixed window', rate: 10, period: MINUTE},

  // Stripe Connect: 3 account creations per organizer per hour.
  // Creating Stripe accounts is expensive and rarely needs retries.
  stripeCreateAccount: {kind: 'fixed window', rate: 3, period: HOUR},

  // Stripe Connect V2: 10 embedded-component Account Sessions per organizer
  // per hour. Sessions are used to render Account Onboarding, Account
  // Management, Payments, and Documents components in-app; the frontend may
  // reopen them across tabs/refreshes. Replaces the v1 `stripeOnboardingLink`
  // and `stripeExpressDashboardLink` rate limit buckets.
  stripeAccountSession: {kind: 'fixed window', rate: 10, period: HOUR},

  // Stripe Connect: 10 status checks per organizer per hour.
  // Polling after onboarding return is common.
  stripeCheckStatus: {kind: 'fixed window', rate: 10, period: HOUR},

  // Admin invite creation: 5 per root admin per hour.
  createAdminInvite: {kind: 'fixed window', rate: 5, period: HOUR},

  // Admin invite to existing community: 5 per admin per hour.
  inviteAdminToExisting: {kind: 'fixed window', rate: 5, period: HOUR},

  // Admin invite redemption: 10 per user per hour.
  // Prevents brute-force token guessing.
  redeemAdminInvite: {kind: 'fixed window', rate: 10, period: HOUR},

  // Application submission: 3 per user per hour.
  // Prevents admin email spam via rapid application submissions.
  submitApplication: {kind: 'fixed window', rate: 3, period: HOUR},

  // Resale notification subscription: 10 per user per minute.
  // Prevents table write amplification.
  subscribeResaleNotifications: {
    kind: 'fixed window',
    rate: 10,
    period: MINUTE,
  },

  // Roster export: 10 per user per event per hour.
  // Prevents accidental hammering and limits data exfiltration from a compromised admin token.
  exportEventRoster: {kind: 'fixed window', rate: 10, period: HOUR},

  // Unsubscribe endpoints: 30 per IP per minute.
  // Public HTTP endpoints that mutate state need rate limiting.
  unsubscribeEndpoint: {
    kind: 'token bucket',
    rate: 30,
    period: MINUTE,
    capacity: 30,
  },
});

/**
 * Rate-limit an unauthenticated public HTTP endpoint by IP.
 * Called from HTTP actions (which cannot directly invoke rateLimiter.limit
 * because it requires MutationCtx) via ctx.runMutation.
 *
 * Throws a ConvexError when the rate limit is exceeded — callers should
 * catch and return HTTP 429.
 */
export const limitPublicEndpoint = internalMutation({
  args: {
    name: v.union(
      v.literal('listPublicEvents'),
      v.literal('listPublicCommunity'),
      v.literal('getPublicCommunityBySlug'),
      v.literal('getPublicEventPreview'),
      v.literal('unsubscribeEndpoint'),
    ),
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // The platform-provided client IP (propagated from the parent HTTP action)
    // takes precedence over args.key: the header-derived key relies on
    // x-real-ip/x-forwarded-for, which clients can spoof to escape their
    // bucket. args.key remains the fallback for runtimes without request
    // metadata; its 'unknown' sentinel (no resolvable IP — e.g. local dev,
    // misconfigured proxies) shares one bucket.
    const {ip} = await getRequestMetadataSafe(ctx);
    const key = ip ?? args.key;
    await rateLimiter.limit(ctx, args.name, {key, throws: true});
    return null;
  },
});

/**
 * Apply a rate limit by name and key.
 * Used from actions (which cannot directly invoke rateLimiter.limit).
 *
 * @param name - The rate limiter configuration name
 * @param key - The rate limit key (e.g., orderId, userId)
 * @throws ConvexError when rate limit is exceeded
 */
export const applyRateLimit = internalMutation({
  args: {
    name: v.union(v.literal('exportEventRoster')),
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await rateLimiter.limit(ctx, args.name, {key: args.key, throws: true});
    return null;
  },
});

/**
 * Apply rate limits for order-related actions.
 * This bridge exists because public actions can't call rateLimiter.limit directly.
 */
export const applyOrderActionRateLimit = internalMutation({
  args: {
    name: v.union(
      v.literal('orderStartCheckout'),
      v.literal('orderSyncCheckoutSession'),
    ),
    key: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await rateLimiter.limit(ctx, args.name, {key: args.key, throws: true});
    return null;
  },
});
