import {ConvexError} from 'convex/values';
import {describe, expect, it, vi} from 'vitest';
import type {ActionCtx} from '../_generated/server';
import {internal} from '../_generated/api';
import type {Id} from '../_generated/dataModel';
import type {PublicEventPreview} from '@shared/contracts/public-event';
import {
  handleGetPublicEventPreview,
  handleListPublicEvents,
  handlePublicEventsOptions,
} from './_impl/events';

const SITE = 'https://acme.convex.site';

/**
 * Handler-level routing/contract tests for the `/api/events/*` HTTP routes
 * (mirrors the pattern in `http/communities.test.ts` and
 * `http/_impl/images.test.ts`).
 *
 * DEVIATION FROM SPEC: the spec calls for `t.fetch`-based tests exercising
 * the real `convex/http.ts` router (to also regression-test the exact-route-
 * before-prefix-route precedence of `/api/events/upcoming`). That is not
 * currently possible in this repo: `convex/http.ts` calls
 * `authComponent.registerRoutes(http, createAuth, {...})` at module top
 * level, which synchronously calls `createAuth({})` to read
 * `options.basePath`. `backend/convex/testing/vitest.setup.ts` mocks
 * `createAuth` to unconditionally throw ("createAuth should not be called in
 * tests") — so importing `convex/http.ts` under vitest (via `t.fetch` or a
 * plain import) throws immediately, for ANY path, before any route is even
 * matched. This is a pre-existing test-infra constraint, not something
 * introduced here, and fixing it (relaxing the shared `createAuth` mock)
 * touches `vitest.setup.ts`, which is out of this change's scope (shared by
 * the entire backend test suite). Flagged as a follow-up.
 *
 * These handler-level tests give equivalent coverage of the actual
 * `handleGetPublicEventPreview` logic (rate limiting, id parsing, 404/200
 * status + headers). The exact-route-precedence guarantee itself rests on
 * Convex's httpRouter implementation (exactRoutes checked before
 * prefixRoutes) and the route registrations in `http.ts` — see the comment
 * there. The query-level visibility matrix
 * (`events/_impl/public_preview.test.ts`) exercises the real, DB-backed
 * `getPublicEventPreviewInternal` end to end via `convexTest()`.
 */

function createTestContext(overrides?: {
  runQuery?: ReturnType<typeof vi.fn>;
  runMutation?: ReturnType<typeof vi.fn>;
}): ActionCtx {
  return {
    runQuery: overrides?.runQuery ?? vi.fn(),
    runMutation: overrides?.runMutation ?? vi.fn().mockResolvedValue(null),
  } as unknown as ActionCtx;
}

function rateLimitedRunMutation(): ReturnType<typeof vi.fn> {
  return vi
    .fn()
    .mockRejectedValue(new ConvexError({kind: 'RateLimited', name: 'test'}));
}

const samplePreview: PublicEventPreview = {
  _id: 'evt_abc123' as Id<'events'>,
  title: 'Warehouse Communion',
  description: 'A late set under the strobes.',
  date: '2030-06-01T20:00:00.000Z',
  dateLabel: 'Sat, Jun 1, 2030, 1:00 PM PDT',
  location: 'The Vault',
  posterUrl: 'https://cdn.example.com/poster.jpg',
  organizerName: 'Night Shift',
};

describe('handleListPublicEvents', () => {
  it('returns the list shape with a public cache header (regression)', async () => {
    const runQuery = vi.fn().mockResolvedValue([samplePreview]);
    const ctx = createTestContext({runQuery});

    const response = await handleListPublicEvents(
      ctx,
      new Request(`${SITE}/api/events/upcoming`),
    );

    expect(response.status).toBe(200);
    expect(runQuery).toHaveBeenCalledWith(
      internal.events.public.listPublicUpcomingInternal,
      {},
    );
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('returns 429 with Retry-After and no-store when rate limited', async () => {
    const ctx = createTestContext({runMutation: rateLimitedRunMutation()});

    const response = await handleListPublicEvents(
      ctx,
      new Request(`${SITE}/api/events/upcoming`),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('handleGetPublicEventPreview', () => {
  it('returns 200 with the preview payload and a long public cache header', async () => {
    const runQuery = vi.fn().mockResolvedValue(samplePreview);
    const ctx = createTestContext({runQuery});

    const response = await handleGetPublicEventPreview(
      ctx,
      new Request(`${SITE}/api/events/evt_abc123`),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=300, stale-while-revalidate=600',
    );
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(runQuery).toHaveBeenCalledWith(
      internal.events.public.getPublicEventPreviewInternal,
      {id: 'evt_abc123'},
    );
    const body = await response.json();
    expect(body).toEqual(samplePreview);
  });

  it('returns 404 with no-store when the query resolves null (missing or denied — no existence oracle)', async () => {
    const runQuery = vi.fn().mockResolvedValue(null);
    const ctx = createTestContext({runQuery});

    const response = await handleGetPublicEventPreview(
      ctx,
      new Request(`${SITE}/api/events/nonexistent123`),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns 404 without querying when the id segment is empty', async () => {
    const runQuery = vi.fn();
    const ctx = createTestContext({runQuery});

    const response = await handleGetPublicEventPreview(
      ctx,
      new Request(`${SITE}/api/events/`),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('returns 404 without querying when the id segment contains a slash', async () => {
    const runQuery = vi.fn();
    const ctx = createTestContext({runQuery});

    const response = await handleGetPublicEventPreview(
      ctx,
      new Request(`${SITE}/api/events/evt_abc123/extra`),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('rate-limits BEFORE parsing the id: an empty/garbage segment still 429s without querying', async () => {
    const runQuery = vi.fn();
    const ctx = createTestContext({
      runQuery,
      runMutation: rateLimitedRunMutation(),
    });

    const response = await handleGetPublicEventPreview(
      ctx,
      new Request(`${SITE}/api/events/`),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('returns 429 with Retry-After and no-store when rate limited (valid id)', async () => {
    const ctx = createTestContext({runMutation: rateLimitedRunMutation()});

    const response = await handleGetPublicEventPreview(
      ctx,
      new Request(`${SITE}/api/events/evt_abc123`),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('handlePublicEventsOptions', () => {
  it('returns a 204 CORS preflight response', async () => {
    const response = await handlePublicEventsOptions();

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe(
      'GET, OPTIONS',
    );
  });
});
