import { type Doc } from '@convex/_generated/dataModel';
import { type api } from '@convex/_generated/api';
import { type FunctionReturnType } from 'convex/server';

export type ResolvedTicketEvent = NonNullable<
  FunctionReturnType<typeof api.tickets.public.getMyTickets>[number]['event']
>;

// Ticket type based on Convex document
export type Ticket = Doc<'tickets'> & {
  // When fetched via getMyTickets, the event may be resolved to a full document
  resolvedEvent?: ResolvedTicketEvent | null;
};
