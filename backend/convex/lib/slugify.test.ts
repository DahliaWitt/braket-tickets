import {describe, it, expect} from 'vitest';
import {generateSlug, ensureUniqueSlug} from './slugify';

describe('generateSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(generateSlug('Underground Collective')).toBe('underground-collective');
  });
  it('removes special characters', () => {
    expect(generateSlug('Braket NYC @#$!')).toBe('braket-nyc');
  });
  it('collapses multiple hyphens', () => {
    expect(generateSlug('foo---bar')).toBe('foo-bar');
  });
  it('trims leading/trailing hyphens', () => {
    expect(generateSlug('  --hello--  ')).toBe('hello');
  });
  it('handles unicode by stripping diacritics', () => {
    expect(generateSlug('Café Résumé')).toBe('cafe-resume');
  });
  it('truncates to max length', () => {
    const long = 'a'.repeat(150);
    expect(generateSlug(long).length).toBeLessThanOrEqual(100);
  });
  it('no trailing hyphen after truncation', () => {
    const name = 'a'.repeat(99) + ' bbbbbbbbbbb';
    const slug = generateSlug(name);
    expect(slug).not.toMatch(/-$/);
    expect(slug.length).toBeLessThanOrEqual(100);
  });
  it('returns fallback for empty result', () => {
    expect(generateSlug('$$$')).toBe('community');
  });
});

describe('ensureUniqueSlug', () => {
  it('returns base slug when no conflict', async () => {
    const checker = async (_s: string): Promise<{_id: string} | null> => null;
    expect(await ensureUniqueSlug('my-slug', checker)).toBe('my-slug');
  });
  it('appends suffix on conflict', async () => {
    let calls = 0;
    const checker = async (_s: string): Promise<{_id: string} | null> => {
      calls++;
      return calls === 1 ? {_id: 'conflict-id'} : null;
    };
    const result = await ensureUniqueSlug('my-slug', checker);
    expect(result).toMatch(/^my-slug-[a-z0-9]+$/);
  });
  it('respects excludeId for self-update', async () => {
    const myId = 'my-doc-id';
    const checker = async (_s: string): Promise<{_id: string} | null> => ({_id: myId});
    const result = await ensureUniqueSlug('my-slug', checker, myId);
    expect(result).toBe('my-slug');
  });
});
