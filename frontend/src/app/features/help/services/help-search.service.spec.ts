import {describe, it, expect, beforeEach} from 'vitest';
import {HelpSearchService} from './help-search.service';
import {type HelpArticle} from '../models/help.models';

const ARTICLES: HelpArticle[] = [
  {
    slug: 'buying-tickets',
    title: 'Buying Tickets',
    category: 'Tickets',
    order: 1,
    description: 'How to buy tickets for events',
    access: 'public',
    section: 'users',
    body: 'To purchase tickets, browse to an event and click the Buy button. You can pay with a credit card.',
  },
  {
    slug: 'payment-methods',
    title: 'Payment Methods',
    category: 'Payments',
    order: 2,
    description: 'Supported payment options',
    access: 'public',
    section: 'users',
    body: 'We support Stripe payment processing for credit and debit cards.',
  },
  {
    slug: 'admin-setup',
    title: 'Admin Setup',
    category: 'Administration',
    order: 1,
    description: 'Setting up your admin account',
    access: 'root_admin',
    section: 'admins',
    body: 'Configure your admin dashboard and permissions.',
  },
];

describe('HelpSearchService', () => {
  let service: HelpSearchService;

  beforeEach(() => {
    service = new HelpSearchService();
    service.buildIndex(ARTICLES);
  });

  it('returns matching results for a query', () => {
    const results = service.search('tickets');
    expect(results.length).toBeGreaterThan(0);
    const slugs = results.map((r) => r.article.slug);
    expect(slugs).toContain('buying-tickets');
  });

  it('returns empty array for no matches', () => {
    const results = service.search('xyzzy-gibberish-nonexistent');
    expect(results).toHaveLength(0);
  });

  it('filters FlexSearch prefix noise when part of the query is gibberish', () => {
    const results = service.search('tickets xyzzy-gibberish-nonexistent');
    expect(results).toHaveLength(0);
  });

  it('searches across title, description, and body', () => {
    const results = service.search('Stripe payment');
    expect(results.length).toBeGreaterThan(0);
    const slugs = results.map((r) => r.article.slug);
    expect(slugs).toContain('payment-methods');
  });

  it('rebuilds index when called again', () => {
    // Rebuild with only the admin article
    service.buildIndex([ARTICLES[2]]);

    const ticketResults = service.search('tickets');
    expect(ticketResults).toHaveLength(0);

    const adminResults = service.search('admin');
    expect(adminResults.length).toBeGreaterThan(0);
    expect(adminResults[0].article.slug).toBe('admin-setup');
  });

  it('handles missing body gracefully (defensive for external JSON)', () => {
    // Simulate external JSON data missing the body field
    // TypeScript type is enforced at compile time, but runtime data may differ
    const articleWithoutBody = {
      slug: 'no-body-article',
      title: 'Article Without Body',
      category: 'Test',
      order: 1,
      description: 'This is the description fallback',
      access: 'public',
      section: 'users',
      body: undefined as unknown as string,
    } as HelpArticle;

    service.buildIndex([articleWithoutBody]);

    // Should not throw when searching
    expect(() => service.search('description')).not.toThrow();

    const results = service.search('description');
    // Should still return results, falling back to description for snippet
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe('This is the description fallback');
  });
});
