export const MAX_COMMUNITY_SLUG_LENGTH = 100;

const COMMUNITY_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function generateCommunitySlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_COMMUNITY_SLUG_LENGTH)
    .replace(/^-|-$/g, '');

  return slug || 'community';
}

export function isCommunitySlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_COMMUNITY_SLUG_LENGTH &&
    COMMUNITY_SLUG_PATTERN.test(value)
  );
}
