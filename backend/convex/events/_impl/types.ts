import type {Infer} from 'convex/values';
import {
  adminEventListItemValidator,
  eventEditDetailValidator,
  managementPurchasesValidator,
  managementResaleValidator,
  managementSummaryValidator,
} from '../../lib/events/validators';

export type AdminEventListItem = Infer<typeof adminEventListItemValidator>;
export type EventEditDetail = Infer<typeof eventEditDetailValidator>;
export type ManagementSummary = Infer<typeof managementSummaryValidator>;
export type ManagementPurchases = Infer<typeof managementPurchasesValidator>;
export type ManagementResaleData = Infer<typeof managementResaleValidator>;
