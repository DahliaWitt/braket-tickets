import {v} from 'convex/values';
import {internalMutation, mutation, query} from '../_generated/server';
import {
  importBatchResultValidator,
  importDedupModeValidator,
} from '../lib/imports/validators';
import {importedTicketHolderValidator} from '../lib/imports/entry_validators';
import {
  checkIn as checkInImpl,
  importBatch as importBatchImpl,
  listByEvent as listByEventImpl,
  redactByEmail as redactByEmailImpl,
  removeBatch as removeBatchImpl,
  removeEntry as removeEntryImpl,
} from './_impl/imported_tickets';

const importedRowValidator = v.object({
  name: v.string(),
  email: v.optional(v.string()),
  externalRef: v.optional(v.string()),
  orderRef: v.optional(v.string()),
  ticketTypeLabel: v.optional(v.string()),
  purchaseDateRaw: v.optional(v.string()),
});

export const importBatch = mutation({
  args: {
    eventId: v.id('events'),
    batchKey: v.string(),
    dedupMode: importDedupModeValidator,
    sourceLabel: v.optional(v.string()),
    rows: v.array(importedRowValidator),
  },
  returns: importBatchResultValidator,
  handler: importBatchImpl,
});

export const removeEntry = mutation({
  args: {id: v.id('importedTicketHolders')},
  returns: v.null(),
  handler: removeEntryImpl,
});

export const removeBatch = mutation({
  args: {eventId: v.id('events'), batchKey: v.string()},
  returns: v.object({
    removedCount: v.number(),
    checkedInCount: v.number(),
  }),
  handler: removeBatchImpl,
});

export const listByEvent = query({
  args: {eventId: v.id('events')},
  returns: v.array(importedTicketHolderValidator),
  handler: listByEventImpl,
});

export const checkIn = mutation({
  args: {id: v.id('importedTicketHolders')},
  returns: v.union(
    v.object({
      success: v.literal(true),
      alreadyCheckedIn: v.boolean(),
      entry: importedTicketHolderValidator,
    }),
    v.object({
      success: v.literal(false),
      message: v.string(),
    }),
  ),
  handler: checkInImpl,
});

/**
 * Internal operator redaction for privacy requests. Redacts imported entries
 * whose email matches the given address across all events.
 */
export const redactByEmail = internalMutation({
  args: {
    email: v.string(),
    operatorUserId: v.id('users'),
    // Pagination cursor for the self-rescheduling redaction sweep; omit/null on
    // the first call.
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({redactedCount: v.number(), isDone: v.boolean()}),
  handler: redactByEmailImpl,
});
