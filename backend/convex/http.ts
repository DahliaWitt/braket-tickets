import {httpRouter} from 'convex/server';
import {httpAction} from './_generated/server';
import {internal} from './_generated/api';
import {authComponent, createAuth} from './lib/better_auth';
import {resend} from './lib/resend_component';
import {
  handleGetPublicCommunityBySlug,
  handleListPublicCommunities,
  handlePublicCommunitiesOptions,
} from './http/_impl/communities';
import {
  handleListPublicEvents,
  handlePublicEventsOptions,
} from './http/_impl/events';
import {resolveHttpEnvironmentConfig} from './http/_impl/config';
import {handleHealthCheck} from './http/_impl/health';
import {createMarketingTrackingHandlers} from './http/_impl/marketing_tracking';
import {
  handleStripeConnectWebhook,
  handleStripeV2EventsWebhook,
  handleStripeWebhook,
} from './http/_impl/stripe';
import {createUnsubscribeHandlers} from './http/_impl/unsubscribe';

const http = httpRouter();
const httpConfig = resolveHttpEnvironmentConfig();
const marketingTrackingHandlers = createMarketingTrackingHandlers(httpConfig);
const unsubscribeHandlers = createUnsubscribeHandlers(httpConfig);

// Register Better Auth HTTP routes with CORS enabled for client-side access
authComponent.registerRoutes(http, createAuth, {
  cors: {
    allowedOrigins: httpConfig.allowedOrigins,
  },
});

http.route({
  path: '/api/health',
  method: 'GET',
  handler: httpAction(handleHealthCheck),
});

http.route({
  path: '/api/events/upcoming',
  method: 'GET',
  handler: httpAction(handleListPublicEvents),
});

http.route({
  path: '/api/events/upcoming',
  method: 'OPTIONS',
  handler: httpAction(handlePublicEventsOptions),
});

http.route({
  path: '/api/communities',
  method: 'GET',
  handler: httpAction(handleListPublicCommunities),
});

http.route({
  pathPrefix: '/api/communities/',
  method: 'GET',
  handler: httpAction(handleGetPublicCommunityBySlug),
});

http.route({
  path: '/api/communities',
  method: 'OPTIONS',
  handler: httpAction(handlePublicCommunitiesOptions),
});

http.route({
  pathPrefix: '/api/communities/',
  method: 'OPTIONS',
  handler: httpAction(handlePublicCommunitiesOptions),
});

http.route({
  path: '/api/unsubscribe',
  method: 'GET',
  handler: httpAction(unsubscribeHandlers.handleUnsubscribeGet),
});

http.route({
  path: '/api/unsubscribe/one-click',
  method: 'GET',
  handler: httpAction(marketingTrackingHandlers.handleMarketingOneClickGet),
});

http.route({
  path: '/api/unsubscribe/one-click',
  method: 'POST',
  handler: httpAction(marketingTrackingHandlers.handleMarketingOneClickPost),
});

http.route({
  path: '/api/marketing/open',
  method: 'GET',
  handler: httpAction(marketingTrackingHandlers.handleMarketingOpenGet),
});

http.route({
  path: '/api/marketing/click',
  method: 'GET',
  handler: httpAction(marketingTrackingHandlers.handleMarketingClickGet),
});

http.route({
  path: '/resend-webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const eventReq = req.clone();
    const response = await resend.handleResendEventWebhook(ctx, req);
    if (!response.ok) {
      return response;
    }

    const event = await eventReq.json();
    await ctx.runMutation(internal.email.resend.handleProviderEvent, {event});
    return response;
  }),
});

http.route({
  path: '/api/unsubscribe-toggle',
  method: 'OPTIONS',
  handler: httpAction(unsubscribeHandlers.handleUnsubscribeToggleOptions),
});

http.route({
  path: '/api/unsubscribe-all',
  method: 'OPTIONS',
  handler: httpAction(unsubscribeHandlers.handleUnsubscribeAllOptions),
});

http.route({
  path: '/api/unsubscribe-preferences',
  method: 'GET',
  handler: httpAction(unsubscribeHandlers.handleUnsubscribePreferencesGet),
});

http.route({
  path: '/api/unsubscribe-toggle',
  method: 'POST',
  handler: httpAction(unsubscribeHandlers.handleUnsubscribeTogglePost),
});

http.route({
  path: '/api/unsubscribe-all',
  method: 'POST',
  handler: httpAction(unsubscribeHandlers.handleUnsubscribeAllPost),
});

// Platform account webhook — events on platform-owned objects
// (application_fee.*, platform-owned event orders).
http.route({
  path: '/stripe/webhook',
  method: 'POST',
  handler: httpAction(handleStripeWebhook),
});

// Connect webhook — v1 snapshot events for connected accounts
// (charges, payments, refunds, disputes, payouts, balance).
http.route({
  path: '/stripe/connect-webhook',
  method: 'POST',
  handler: httpAction(handleStripeConnectWebhook),
});

// Accounts V2 Event Destination — thin event notifications for account
// lifecycle (v2.core.account.updated, requirements, capability transitions).
http.route({
  path: '/stripe/v2-events',
  method: 'POST',
  handler: httpAction(handleStripeV2EventsWebhook),
});

export default http;
