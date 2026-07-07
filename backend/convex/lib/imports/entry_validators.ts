/**
 * Return-shape validators for imported ticket-holder read models.
 */
import {v} from 'convex/values';

export const importedTicketHolderFields = {
  _id: v.id('importedTicketHolders'),
  _creationTime: v.number(),
  eventId: v.id('events'),
  name: v.string(),
  email: v.optional(v.string()),
  externalRef: v.optional(v.string()),
  externalRefKey: v.optional(v.string()),
  orderRef: v.optional(v.string()),
  ticketTypeLabel: v.optional(v.string()),
  purchaseDateRaw: v.optional(v.string()),
  sourceLabel: v.string(),
  batchKey: v.string(),
  checkedInAt: v.optional(v.number()),
  checkedInBy: v.optional(v.id('users')),
};

export const importedTicketHolderValidator = v.object(
  importedTicketHolderFields,
);
