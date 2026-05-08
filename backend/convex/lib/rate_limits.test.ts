import {convexTest} from '../setup.testing';
import {describe, it, expect} from 'vitest';
import {internal} from '../_generated/api';

describe('limitPublicEndpoint', () => {
  it('allows requests within the listPublicCommunity bucket', async () => {
    const t = convexTest();

    // First call should succeed (well within the 30/min token bucket)
    await expect(
      t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'listPublicCommunity',
        key: '192.0.2.1',
      }),
    ).resolves.toBeNull();
  });

  it('allows requests within the getPublicCommunityBySlug bucket', async () => {
    const t = convexTest();

    await expect(
      t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'getPublicCommunityBySlug',
        key: '192.0.2.1',
      }),
    ).resolves.toBeNull();
  });

  it('rate limits listPublicCommunity after bucket is exhausted (30 requests)', async () => {
    const t = convexTest();
    const key = '192.0.2.2';

    // Exhaust the full token bucket capacity (30)
    for (let i = 0; i < 30; i++) {
      await t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'listPublicCommunity',
        key,
      });
    }

    // 31st request should throw
    await expect(
      t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'listPublicCommunity',
        key,
      }),
    ).rejects.toThrow();
  });

  it('rate limits getPublicCommunityBySlug after bucket is exhausted (60 requests)', async () => {
    const t = convexTest();
    const key = '192.0.2.3';

    // Exhaust the full token bucket capacity (60)
    for (let i = 0; i < 60; i++) {
      await t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'getPublicCommunityBySlug',
        key,
      });
    }

    // 61st request should throw
    await expect(
      t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'getPublicCommunityBySlug',
        key,
      }),
    ).rejects.toThrow();
  });

  it('uses separate buckets per key (different IPs do not interfere)', async () => {
    const t = convexTest();

    // Exhaust one IP's bucket
    for (let i = 0; i < 30; i++) {
      await t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'listPublicCommunity',
        key: '192.0.2.10',
      });
    }

    // A different IP's bucket is unaffected
    await expect(
      t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'listPublicCommunity',
        key: '192.0.2.11',
      }),
    ).resolves.toBeNull();
  });

  it('uses separate buckets for the two endpoint names (list vs slug)', async () => {
    const t = convexTest();
    const key = '192.0.2.20';

    // Exhaust the listPublicCommunity bucket (30)
    for (let i = 0; i < 30; i++) {
      await t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'listPublicCommunity',
        key,
      });
    }

    // getPublicCommunityBySlug bucket for the same IP is independent (60 capacity)
    await expect(
      t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'getPublicCommunityBySlug',
        key,
      }),
    ).resolves.toBeNull();
  });

  it('applies the shared unknown sentinel bucket for unresolvable IPs', async () => {
    const t = convexTest();

    // First call with sentinel key should succeed
    await expect(
      t.mutation(internal.lib.rate_limits.limitPublicEndpoint, {
        name: 'listPublicCommunity',
        key: 'unknown',
      }),
    ).resolves.toBeNull();
  });
});
