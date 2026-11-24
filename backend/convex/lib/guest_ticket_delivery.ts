/**
 * A normal guest-ticket send completes in seconds. A lock older than this
 * window is considered abandoned so a crashed action cannot block retries
 * forever.
 */
export const GUEST_TICKET_SEND_LOCK_STALE_MS = 5 * 60 * 1000;

export function isGuestTicketSendInFlight(
  lockedAt: number | null | undefined,
  now = Date.now(),
): boolean {
  return (
    typeof lockedAt === 'number' &&
    now - lockedAt < GUEST_TICKET_SEND_LOCK_STALE_MS
  );
}
