import {describe, expect, it} from 'vitest';
import {addConvexPreconnects} from './preconnect';

function createDoc(): Document {
  return document.implementation.createHTMLDocument('test');
}

function preconnectHrefs(doc: Document): string[] {
  return Array.from(
    doc.head.querySelectorAll('link[rel="preconnect"]'),
    (link) => link.getAttribute('href') ?? '',
  );
}

describe('addConvexPreconnects', () => {
  it('adds one preconnect link per origin', () => {
    const doc = createDoc();

    addConvexPreconnects(doc, [
      'https://happy-animal-123.convex.cloud',
      'https://happy-animal-123.convex.site',
    ]);

    expect(preconnectHrefs(doc)).toEqual([
      'https://happy-animal-123.convex.cloud',
      'https://happy-animal-123.convex.site',
    ]);
  });

  it('reduces URLs with paths to their origin', () => {
    const doc = createDoc();

    addConvexPreconnects(doc, [
      'https://happy-animal-123.convex.site/api/auth',
    ]);

    expect(preconnectHrefs(doc)).toEqual([
      'https://happy-animal-123.convex.site',
    ]);
  });

  it('dedupes URLs sharing an origin', () => {
    const doc = createDoc();

    addConvexPreconnects(doc, [
      'https://happy-animal-123.convex.cloud',
      'https://happy-animal-123.convex.cloud/some/path',
    ]);

    expect(preconnectHrefs(doc)).toHaveLength(1);
  });

  it('skips invalid URLs without throwing', () => {
    const doc = createDoc();

    addConvexPreconnects(doc, ['not a url', '']);

    expect(preconnectHrefs(doc)).toHaveLength(0);
  });

  it('skips the document own origin', () => {
    // createHTMLDocument has a null location, so use the real test document,
    // which carries the runner's origin.
    const before = preconnectHrefs(document);

    addConvexPreconnects(document, [`${window.location.origin}/api`]);

    expect(preconnectHrefs(document)).toEqual(before);
  });
});
