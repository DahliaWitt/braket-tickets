// @vitest-environment node

import {describe, expect, it} from 'vitest';

import {resolveConvexEnvValue} from './sync-env-values';

describe('resolveConvexEnvValue', () => {
  it('rewrites the frontend PostHog proxy host to the backend US ingest host', () => {
    expect(
      resolveConvexEnvValue('POSTHOG_HOST', {
        POSTHOG_HOST: '/ingest',
      }),
    ).toBe('https://us.i.posthog.com');
  });

  it('keeps explicit PostHog backend hosts unchanged', () => {
    expect(
      resolveConvexEnvValue('POSTHOG_HOST', {
        POSTHOG_HOST: 'https://us.i.posthog.com',
      }),
    ).toBe('https://us.i.posthog.com');
  });

  it('passes non-PostHog keys through unchanged', () => {
    expect(
      resolveConvexEnvValue('SITE_URL', {
        SITE_URL: 'https://community.braket.gay',
      }),
    ).toBe('https://community.braket.gay');
  });
});
