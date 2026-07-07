import {v} from 'convex/values';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import {guestTypeValidator} from '../lib/validators/guests';
import {guestValidator} from '../lib/events/validators';
import {importBatchResultValidator} from '../lib/imports/validators';
import {
  add as addImpl,
  getInternal as getInternalImpl,
  listByEvent as listByEventImpl,
  markAsEmailed as markAsEmailedImpl,
  remove as removeImpl,
} from './_impl/guests';
import {addMany as addManyImpl} from './_impl/guests_import';

export const add = mutation({
  args: {
    eventId: v.id('events'),
    name: v.string(),
    email: v.optional(v.string()),
    type: guestTypeValidator,
    notes: v.optional(v.string()),
  },
  returns: v.id('guests'),
  handler: addImpl,
});

export const addMany = mutation({
  args: {
    eventId: v.id('events'),
    batchKey: v.string(),
    rows: v.array(
      v.object({
        name: v.string(),
        email: v.optional(v.string()),
        // Free string on purpose: an invalid type value must surface as a
        // per-row `invalid` outcome, not be rejected by the arg validator.
        type: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  returns: importBatchResultValidator,
  handler: addManyImpl,
});

export const remove = mutation({
  args: {id: v.id('guests')},
  returns: v.null(),
  handler: removeImpl,
});

export const listByEvent = query({
  args: {eventId: v.id('events')},
  returns: v.array(guestValidator),
  handler: listByEventImpl,
});

export const getInternal = internalQuery({
  args: {id: v.id('guests')},
  returns: v.union(guestValidator, v.null()),
  handler: getInternalImpl,
});

export const markAsEmailed = internalMutation({
  args: {id: v.id('guests')},
  returns: v.null(),
  handler: markAsEmailedImpl,
});
