import {Injectable} from '@angular/core';
import {Document} from 'flexsearch';
import type {HelpArticle, HelpSearchResult} from '../models/help.models';

@Injectable()
export class HelpSearchService {
  private index: Document | null = null;
  private articles: HelpArticle[] = [];

  buildIndex(articles: HelpArticle[]): void {
    this.articles = articles;
    this.index = new Document({
      document: {
        id: 'slug',
        index: ['title', 'description', 'body'],
        store: true,
      },
      tokenize: 'forward',
    });
    for (const article of articles) {
      this.index.add(article as unknown as Record<string, string>);
    }
  }

  search(query: string, limit = 10): HelpSearchResult[] {
    const queryTokens = tokenizeQuery(query);
    if (!this.index || queryTokens.length === 0) return [];
    const results = this.index.search(query, {limit, enrich: true});
    const seen = new Set<string>();
    const output: HelpSearchResult[] = [];
    for (const fieldResult of results) {
      for (const hit of fieldResult.result) {
        const slug = String(hit.id);
        if (seen.has(slug)) continue;
        seen.add(slug);
        const article = this.articles.find((a) => a.slug === slug);
        if (!article) continue;
        if (!articleMatchesQuery(article, queryTokens)) continue;
        const body = article.body;
        // Fall back to description if body is missing (defensive for external JSON data)
        if (!body) {
          output.push({article, snippet: article.description});
          continue;
        }
        const lowerBody = body.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const matchIdx = lowerBody.indexOf(lowerQuery);
        let snippet: string;
        if (matchIdx >= 0) {
          const start = Math.max(0, matchIdx - 40);
          const end = Math.min(body.length, matchIdx + query.length + 80);
          snippet =
            (start > 0 ? '...' : '') +
            body.slice(start, end) +
            (end < body.length ? '...' : '');
        } else {
          snippet = article.description;
        }
        output.push({article, snippet});
      }
    }
    return output;
  }
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function articleMatchesQuery(
  article: HelpArticle,
  queryTokens: string[],
): boolean {
  const haystack = [
    article.title,
    article.category,
    article.description,
    article.body ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return queryTokens.every((token) =>
    tokenVariants(token).some((variant) => haystack.includes(variant)),
  );
}

function tokenVariants(token: string): string[] {
  if (token.length > 3 && token.endsWith('s')) {
    return [token, token.slice(0, -1)];
  }
  return [token];
}
