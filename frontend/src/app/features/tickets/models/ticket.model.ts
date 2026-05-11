import {type api} from '@convex/_generated/api';
import {type FunctionReturnType} from 'convex/server';

type TicketQueryResult = FunctionReturnType<
  typeof api.tickets.public.getMyTickets
>[number];

export type ResolvedTicketEvent = NonNullable<TicketQueryResult['event']>;

export type Ticket = Omit<TicketQueryResult, 'event'> & {
  // When fetched via getMyTickets, the event may be resolved to a full document
  resolvedEvent?: ResolvedTicketEvent | null;
};
