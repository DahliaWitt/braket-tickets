import {
  generateCommunitySlug,
  MAX_COMMUNITY_SLUG_LENGTH,
} from '@shared/domain/community-slug';

/**
 * Generate a URL-safe slug from a community name.
 * - Strips diacritics, lowercases, replaces non-alphanumeric with hyphens
 * - Collapses multiple hyphens, truncates, trims edges
 * - Returns 'community' as fallback for empty results
 */
export function generateSlug(name: string): string {
  return generateCommunitySlug(name);
}

/**
 * Ensure a slug is unique by checking against a lookup function.
 * If the base slug conflicts, appends a random 4-char suffix and retries (up to 5 attempts).
 * The checker function should query by_slug index and return null if available.
 */
export async function ensureUniqueSlug(
  baseSlug: string,
  checkExists: (slug: string) => Promise<{_id: string} | null>,
  excludeId?: string,
): Promise<string> {
  // Reserve space for suffix (-xxxx = 5 chars) so total never exceeds max length
  const maxBase = MAX_COMMUNITY_SLUG_LENGTH - 5;
  const truncatedBase = baseSlug.slice(0, maxBase).replace(/-$/, '');

  const tryCandidate = async (
    candidate: string,
    attempt: number,
  ): Promise<string> => {
    const existing = await checkExists(candidate);
    if (!existing || existing._id === excludeId) return candidate;

    if (attempt >= 4) {
      return `${truncatedBase}-${Date.now().toString(36).slice(0, 4)}`;
    }

    const suffix = Math.random().toString(36).slice(2, 6);
    return tryCandidate(`${truncatedBase}-${suffix}`, attempt + 1);
  };

  return tryCandidate(baseSlug, 0);
}
