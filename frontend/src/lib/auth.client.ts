/**
 * Better Auth client configuration for Angular frontend.
 *
 * This client handles authentication via Better Auth's HTTP API.
 * It communicates with the Convex backend which runs Better Auth server-side.
 */

import {createAuthClient} from 'better-auth/client';
import {
  convexClient,
  crossDomainClient,
} from '@convex-dev/better-auth/client/plugins';
import {environment} from '../environments/environment';
import {BETTER_AUTH_STORAGE_PREFIX} from './auth-storage';

// Better Auth HTTP routes are on .convex.site (port 3211), not .convex.cloud (port 3210)
// Port 3210 (.convex.cloud) = Convex functions API (queries, mutations, actions)
// Port 3211 (.convex.site) = HTTP routes (Better Auth endpoints at /api/auth/*)
// This value is set per environment (production vs local E2E testing)
const CONVEX_SITE_URL = environment.convexSiteUrl;

// Use environment flag to detect E2E mode (not URL detection)
// In E2E mode, the server disables crossDomain plugin, so the client should too
// This ensures both use cookie-based auth instead of localStorage + OTT
// Local dev uses localhost URLs but is NOT E2E mode - the flag differentiates them
const isE2EMode = environment.isE2E;
const browserStorage =
  typeof window !== 'undefined' ? window.localStorage : undefined;

// The convexClient plugin declares `$InferServerPlugin`, so `convex.token()` is
// inferred with a real `{token: string}` return type — no manual assertion needed.
export const authClient = createAuthClient({
  baseURL: CONVEX_SITE_URL,
  // Required for cross-origin requests to include cookies
  fetchOptions: {
    credentials: 'include',
  },
  // Stateless client contract: token refreshes are fetched from Better Auth on demand.
  // This client does not keep its own access-token cache; Better Auth session caching
  // (when enabled server-side) is the performance layer.
  plugins: [
    convexClient(),
    // Only include crossDomainClient in production (not E2E)
    // When disabled, auth uses cookies directly instead of localStorage + OTT
    ...(isE2EMode || !browserStorage
      ? []
      : [
          crossDomainClient({
            storage: browserStorage,
            storagePrefix: BETTER_AUTH_STORAGE_PREFIX,
          }),
        ]),
  ],
});
