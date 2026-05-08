import {describe, expect, it} from 'vitest';

import {toRouteTemplate} from './route-template';

describe('toRouteTemplate', () => {
  it('normalizes event ids', () => {
    expect(toRouteTemplate('/events/01j2k3l4m5n6o7p8q9/details')).toBe(
      '/events/:id/details',
    );
  });

  it('normalizes community ids', () => {
    expect(toRouteTemplate('/communities/01j2k3l4m5n6o7p8q9/settings')).toBe(
      '/communities/:id/settings',
    );
  });

  it('normalizes invite tokens', () => {
    expect(
      toRouteTemplate(
        '/communities/01j2k3l4m5n6o7p8q9/invite/abcDEF123_-abcDEF123_-',
      ),
    ).toBe('/communities/:id/invite/:token');
  });

  it('normalizes admin invite and verification token routes', () => {
    expect(toRouteTemplate('/admin-invite/demo-admin-invite-lot45')).toBe(
      '/admin-invite/:token',
    );
    expect(toRouteTemplate('/confirm/verification/short-token')).toBe(
      '/confirm/verification/:token',
    );
  });

  it('normalizes unsubscribe tokens', () => {
    expect(
      toRouteTemplate('/unsubscribe/abcDEF123_-abcDEF123_-abcDEF123_-'),
    ).toBe('/unsubscribe/:token');
  });

  it('removes query strings and preserves non-sensitive segments', () => {
    expect(
      toRouteTemplate(
        'https://braket.local/orders/01j2k3l4m5n6o7p8q9?tab=payments&ticket=2',
      ),
    ).toBe('/orders/:id');
  });

  it('does not throw on malformed percent-encoded segments', () => {
    expect(toRouteTemplate('/search/%zz/details')).toBe('/search/%zz/details');
  });
});
