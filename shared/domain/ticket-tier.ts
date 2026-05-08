export const TICKET_TIERS = ['regular', 'notaflof', 'supporter'] as const;
export type TicketTier = typeof TICKET_TIERS[number];
