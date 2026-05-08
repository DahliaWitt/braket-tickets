import type {PricingStats} from '../../lib/stats';
import {computePricingStats} from '../../lib/stats';
import type {TicketTier} from '../../lib/validators/ticketing';
import type {Id} from '../../_generated/dataModel';
import type {QueryCtx} from '../../_generated/server';
import {requireEventForManage} from '../../lib/access';
import {loadEventOrderFinancials} from '../../lib/orders/financial_reporting';

export async function getEventTierPricingStats(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>},
): Promise<{tiers: (PricingStats & {tier: TicketTier})[]}> {
  const {event} = await requireEventForManage(ctx, args.eventId);

  const completed = await loadEventOrderFinancials(ctx.db, args.eventId);

  const byTier = new Map<TicketTier, number[]>();
  for (const order of completed) {
    if (order.recognizedQuantity <= 0) {
      continue;
    }

    const tier: TicketTier = order.tier;
    if (tier === 'regular') {
      continue;
    }
    if (tier === 'notaflof' && !event.slidingScaleEnabled) {
      continue;
    }

    const qty = order.quantity;
    const perTicketAmount = Math.round(order.capturedAmountCents / qty);
    const amounts = byTier.get(tier) ?? [];
    for (let i = 0; i < order.recognizedQuantity; i++) {
      amounts.push(perTicketAmount);
    }
    byTier.set(tier, amounts);
  }

  const tiers: (PricingStats & {tier: TicketTier})[] = [];
  for (const [tier, amounts] of byTier) {
    const stats = computePricingStats(amounts);
    if (stats) {
      tiers.push({tier, ...stats});
    }
  }

  return {tiers};
}
