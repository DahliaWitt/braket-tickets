import {type PaymentService} from '../../services/payment.service';

export type CheckoutSettlementState = 'completed' | 'released' | 'open';

const CHECKOUT_STATUS_POLL_RETRY_COUNT = 5;
const CHECKOUT_STATUS_POLL_DELAY_MS = 300;

interface AwaitCheckoutSettlementOptions {
  paymentService: Pick<
    PaymentService,
    'syncCheckoutSession' | 'getCheckoutStatus'
  >;
  orderId: string;
  checkoutSessionId: string;
  sessionToken?: string;
}

export async function awaitCheckoutSettlement({
  paymentService,
  orderId,
  checkoutSessionId,
  sessionToken,
}: AwaitCheckoutSettlementOptions): Promise<CheckoutSettlementState> {
  let status = await paymentService.syncCheckoutSession(
    checkoutSessionId,
    sessionToken,
  );
  if (status.state !== 'open') {
    return status.state;
  }

  for (
    let attempt = 0;
    attempt < CHECKOUT_STATUS_POLL_RETRY_COUNT;
    attempt += 1
  ) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, CHECKOUT_STATUS_POLL_DELAY_MS),
    );
    status = await paymentService.getCheckoutStatus(orderId, sessionToken);
    if (status.state !== 'open') {
      return status.state;
    }
  }

  return 'open';
}
