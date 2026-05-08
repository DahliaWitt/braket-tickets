export const TICKET_SALES_STATUSES = ['active', 'paused', 'ended'] as const;
export type TicketSalesStatus = typeof TICKET_SALES_STATUSES[number];
