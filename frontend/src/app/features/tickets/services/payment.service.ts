import {
  Injectable,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import {injectConvex, injectQuery, skipToken} from 'convex-angular';

import {AuthService} from '@/core/services/auth.service';
import {api} from '@convex/_generated/api';
import {type Ticket} from '../models/ticket.model';
import {type Id} from '@convex/_generated/dataModel';
import {type FunctionArgs, type FunctionReturnType} from 'convex/server';
import {logger} from '@/utils/logger';
import {toEventId} from '@/utils/convex-id';
import type {TicketTier} from '@shared/domain/ticket-tier';
import {extractPaymentErrorMessage} from './payment-error-messages';
import {GuestSessionTokenStoreService} from './guest-session-token-store.service';

/**
 * Checkout session response shape — pulled from the backend contract so
 * the frontend stays locked to the V2 `orders.startCheckout` return
 * validator (including the new `connectedAccountId` field from Task 4).
 */
export type CheckoutSessionResponse = FunctionReturnType<
  typeof api.orders.core.startCheckout
>;

export type CheckoutStatusResponse = FunctionReturnType<
  typeof api.orders.core.syncCheckoutSession
>;

type TicketQueryResult = FunctionReturnType<
  typeof api.tickets.public.getMyTickets
>[number];
type StartCheckoutArgs = FunctionArgs<typeof api.orders.core.startCheckout>;
type CheckoutTheme = NonNullable<StartCheckoutArgs['checkoutTheme']>;
interface CheckoutOrder {
  orderId: StartCheckoutArgs['orderId'];
}

@Injectable({
  providedIn: 'root',
})
export class PaymentService {
  private convex = injectConvex();
  private auth = inject(AuthService);
  private guestSessionTokens = inject(GuestSessionTokenStoreService);

  private readonly authScope = computed(() => {
    if (!this.auth.isAuthenticated()) {
      return null;
    }

    const user = this.auth.currentUser();
    return user ? user._id : 'authenticated';
  });

  private readonly refreshMaskActive = signal(false);
  private readonly pendingTicketsRefetch = signal(false);

  private readonly visibleTicketsScope = linkedSignal<
    string | null,
    string | null
  >({
    source: this.authScope,
    computation: (scope, previous) => {
      if (scope === null) {
        return null;
      }

      return previous?.source === scope ? previous.value : null;
    },
  });

  private readonly shouldHideTicketsResource = computed(() => {
    const scope = this.authScope();
    return (
      scope !== null &&
      (this.refreshMaskActive() || this.visibleTicketsScope() !== scope)
    );
  });

  private readonly ticketsQuery = injectQuery(
    api.tickets.public.getMyTickets,
    () => (this.authScope() === null ? skipToken : {}),
    {
      onSuccess: () => this.onTicketsQuerySettled(),
      onError: () => this.onTicketsQuerySettled(),
    },
  );

  constructor() {
    effect(() => {
      if (this.authScope() !== null) {
        return;
      }

      this.pendingTicketsRefetch.set(false);
      this.refreshMaskActive.set(false);
    });
  }

  triggerRefresh(): void {
    if (this.authScope() === null) {
      return;
    }

    this.refreshMaskActive.set(true);
    this.refetchTicketsWhenIdle();
  }

  private onTicketsQuerySettled(): void {
    const scope = this.authScope();
    if (scope === null) {
      this.pendingTicketsRefetch.set(false);
      this.refreshMaskActive.set(false);
      this.visibleTicketsScope.set(null);
      return;
    }

    if (this.pendingTicketsRefetch()) {
      this.pendingTicketsRefetch.set(false);
      this.ticketsQuery.refetch();
      return;
    }

    this.refreshMaskActive.set(false);
    this.visibleTicketsScope.set(scope);
  }

  private refetchTicketsWhenIdle(): void {
    if (this.ticketsQuery.isLoading()) {
      this.pendingTicketsRefetch.set(true);
      return;
    }

    this.pendingTicketsRefetch.set(false);
    this.ticketsQuery.refetch();
  }

  private mapTickets(ticketsData: unknown): Ticket[] {
    if (!Array.isArray(ticketsData)) {
      return [];
    }

    return ticketsData
      .map((ticketData) => {
        if (!ticketData || typeof ticketData !== 'object') {
          return null;
        }

        const t = ticketData as TicketQueryResult;
        const {event, ...ticketFields} = t;

        const ticket: Ticket = {...ticketFields};

        if (event) {
          ticket.resolvedEvent = event;
        }

        return ticket;
      })
      .filter((ticket): ticket is Ticket => ticket !== null);
  }

  readonly ticketsResource = {
    value: computed(() => {
      if (this.authScope() === null || this.shouldHideTicketsResource()) {
        return [];
      }

      return this.mapTickets(this.ticketsQuery.data());
    }),
    isLoading: this.ticketsQuery.isLoading,
    error: this.ticketsQuery.error,
  };

  async getMyTickets(): Promise<Ticket[]> {
    const ticketsData = await this.convex.query(
      api.tickets.public.getMyTickets,
      {},
    );
    return this.mapTickets(ticketsData);
  }

  async getMyTicketPdf(ticketId: Id<'tickets'>): Promise<string> {
    return this.convex.action(api.tickets.actions.getMyTicketPdf, {ticketId});
  }

  async refundTicket(ticketId: string): Promise<boolean> {
    const result = await this.convex.action(api.payments.refunds.refundTicket, {
      ticketId: ticketId as Id<'tickets'>,
    });
    return result.success;
  }

  async claimFreeTicket(
    eventId: string,
    quantity: number,
    tier: TicketTier,
  ): Promise<{success: boolean}> {
    const convexEventId = toEventId(eventId);
    // Fresh key per claim attempt. The Convex client reuses these identical
    // args across its automatic mutation retries, so a network retry replays
    // the same completed order while a deliberate new claim mints a new key
    // and issues a fresh ticket.
    const idempotencyKey = crypto.randomUUID();
    logger.info('[claimFreeTicket] Claiming free ticket', {
      eventId,
      quantity,
      tier,
    });
    try {
      const result = await this.convex.mutation(
        api.orders.core.claimFreeTicket,
        {
          eventId: convexEventId,
          quantity,
          tier,
          idempotencyKey,
        },
      );
      logger.info('[claimFreeTicket] Claimed', {success: result.success});
      return result;
    } catch (error: unknown) {
      logger.error('[claimFreeTicket] Failed', error);
      throw new Error(extractPaymentErrorMessage(error), {cause: error});
    }
  }

  async claimFreeTicketAsGuest(
    eventId: string,
    quantity: number,
    tier: TicketTier,
    sessionToken: string,
    termsAccepted: boolean,
  ): Promise<{success: boolean}> {
    const convexEventId = toEventId(eventId);
    // Fresh key per claim attempt; reused verbatim across the Convex client's
    // automatic mutation retries so a network retry replays the same order.
    const idempotencyKey = crypto.randomUUID();
    logger.info('[claimFreeTicketAsGuest] Claiming', {eventId, quantity, tier});
    try {
      const result = await this.convex.mutation(
        api.orders.core.claimFreeTicketAsGuest,
        {
          eventId: convexEventId,
          quantity,
          tier,
          sessionToken,
          termsAccepted,
          idempotencyKey,
        },
      );
      logger.info('[claimFreeTicketAsGuest] Claimed', {
        success: result.success,
      });
      return result;
    } catch (error: unknown) {
      logger.error('[claimFreeTicketAsGuest] Failed', error);
      throw new Error(extractPaymentErrorMessage(error), {cause: error});
    }
  }

  async startPrimaryCheckoutSession(
    eventId: string,
    quantity: number,
    tier: TicketTier,
    totalAmount: number,
    checkoutTheme: CheckoutTheme,
  ): Promise<CheckoutSessionResponse> {
    const convexEventId = toEventId(eventId);
    logger.group('Checkout Session (Primary)');
    logger.info('[startPrimaryCheckoutSession] Opening order', {
      eventId,
      quantity,
      tier,
      totalAmount,
    });

    return this.startCheckoutForOrder(
      'startPrimaryCheckoutSession',
      () =>
        this.convex.mutation(api.orders.core.open, {
          eventId: convexEventId,
          quantity,
          tier,
          totalAmount,
        }),
      checkoutTheme,
    );
  }

  async startGuestCheckoutSession(
    eventId: string,
    quantity: number,
    tier: TicketTier,
    totalAmount: number,
    sessionToken: string,
    checkoutTheme: CheckoutTheme,
    termsAccepted: boolean,
  ): Promise<CheckoutSessionResponse> {
    const convexEventId = toEventId(eventId);
    logger.group('Checkout Session (Guest)');
    logger.info('[startGuestCheckoutSession] Opening guest order', {
      eventId,
      quantity,
      tier,
      totalAmount,
    });

    return this.startCheckoutForOrder(
      'startGuestCheckoutSession',
      () =>
        this.convex.mutation(api.orders.core.openForGuest, {
          sessionToken,
          eventId: convexEventId,
          quantity,
          tier,
          totalAmount,
          termsAccepted,
        }),
      checkoutTheme,
      sessionToken,
    );
  }

  async startResaleCheckoutSession(
    eventId: string,
    tier: TicketTier,
    totalAmount: number,
    checkoutTheme: CheckoutTheme,
  ): Promise<CheckoutSessionResponse> {
    const convexEventId = toEventId(eventId);
    logger.group('Checkout Session (Resale)');
    logger.info('[startResaleCheckoutSession] Opening resale order', {
      eventId,
      tier,
      totalAmount,
    });

    return this.startCheckoutForOrder(
      'startResaleCheckoutSession',
      () =>
        this.convex.mutation(api.orders.core.openResale, {
          eventId: convexEventId,
          tier,
          totalAmount,
        }),
      checkoutTheme,
    );
  }

  private async startCheckoutForOrder(
    methodName: string,
    openOrder: () => Promise<CheckoutOrder>,
    checkoutTheme: CheckoutTheme,
    sessionToken?: string,
  ): Promise<CheckoutSessionResponse> {
    try {
      const order = await openOrder();
      const startCheckoutArgs: StartCheckoutArgs = sessionToken
        ? {orderId: order.orderId, checkoutTheme, sessionToken}
        : {orderId: order.orderId, checkoutTheme};
      const session = await this.convex.action(
        api.orders.core.startCheckout,
        startCheckoutArgs,
      );

      logger.info(`[${methodName}] Session ready`, {
        orderId: session.orderId,
        stripeCheckoutSessionId: session.stripeCheckoutSessionId,
        connectedAccountId: session.connectedAccountId,
      });

      return session;
    } catch (error: unknown) {
      logger.error(`[${methodName}] Failed`, error);
      throw new Error(extractPaymentErrorMessage(error), {cause: error});
    } finally {
      logger.groupEnd();
    }
  }

  async syncCheckoutSession(
    checkoutSessionId: string,
    sessionToken?: string,
  ): Promise<CheckoutStatusResponse> {
    logger.info('[syncCheckoutSession] Syncing session', {checkoutSessionId});

    try {
      const status = await this.convex.action(
        api.orders.core.syncCheckoutSession,
        {
          checkoutSessionId,
          sessionToken,
        },
      );

      logger.info('[syncCheckoutSession] Session synced', {
        orderId: status.orderId,
        state: status.state,
      });

      return status;
    } catch (error: unknown) {
      logger.error('[syncCheckoutSession] Failed', error);
      throw new Error(extractPaymentErrorMessage(error), {cause: error});
    }
  }

  async getCheckoutStatus(
    orderId: string,
    sessionToken?: string,
  ): Promise<CheckoutStatusResponse> {
    logger.info('[getCheckoutStatus] Fetching order status', {orderId});

    try {
      return await this.convex.query(api.orders.core.getCheckoutStatus, {
        orderId: orderId as Id<'ticket_orders'>,
        sessionToken,
      });
    } catch (error: unknown) {
      logger.error('[getCheckoutStatus] Failed', error);
      throw new Error(extractPaymentErrorMessage(error), {cause: error});
    }
  }

  async initiateGuestSession(
    email: string,
    magicLinkToken?: string,
    eventId?: Id<'events'>,
  ): Promise<{sessionToken: string}> {
    logger.info('[initiateGuestSession] Starting', {email});
    const existingSessionToken = this.guestSessionTokens.get(email);
    const result = await this.convex.action(
      api.guest_sessions.actions.initiateGuestSession,
      {
        email,
        ...(eventId ? {eventId} : {}),
        ...(existingSessionToken ? {existingSessionToken} : {}),
        ...(magicLinkToken ? {magicLinkToken} : {}),
      },
    );
    this.guestSessionTokens.set(email, result.sessionToken);
    return result;
  }

  rememberGuestSessionToken(email: string, sessionToken: string): void {
    this.guestSessionTokens.set(email, sessionToken);
  }
}
