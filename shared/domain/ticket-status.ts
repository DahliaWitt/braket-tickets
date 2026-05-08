export const TICKET_STATUSES = ['valid', 'used', 'refunded', 'expired'] as const;
export type TicketStatus = typeof TICKET_STATUSES[number];
