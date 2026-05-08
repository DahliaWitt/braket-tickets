import {throwAppError} from './errors';

export const MAX_TRUST_LINKS = 20;

export function assertTrustLinkLimit(trustLinkCount: number): void {
  if (trustLinkCount > MAX_TRUST_LINKS) {
    throwAppError(
      'TRUST_LINK_LIMIT_EXCEEDED',
      `Too many active trust links (${trustLinkCount}). Max supported: ${MAX_TRUST_LINKS}.`,
      {trustLinkCount, maxTrustLinks: MAX_TRUST_LINKS},
    );
  }
}
