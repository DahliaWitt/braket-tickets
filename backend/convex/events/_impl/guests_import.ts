import type {Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {requireEventForEdit} from '../../lib/access';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {
  MAX_GUEST_EMAIL_LENGTH,
  MAX_GUEST_NAME_LENGTH,
  MAX_GUEST_NOTES_LENGTH,
  emailHasAtSign,
} from '../../lib/validation';
import {GUEST_TYPES, type GuestType} from '../../lib/validators/guests';
import {
  assertBatchSizeWithinCap,
  findExistingImportBatch,
  insertImportBatch,
  nameEmailDedupKey,
} from '../../lib/imports/bulk';
import type {
  ImportBatchResult,
  ImportRowOutcome,
} from '../../lib/imports/validators';

/**
 * One raw guest row from the parsed CSV. `type` is a free string here because
 * an invalid type value must surface as a per-row `invalid` outcome rather than
 * being coerced — the argument validator therefore accepts any string.
 */
export type GuestImportRow = {
  name: string;
  email?: string;
  type?: string;
  notes?: string;
};

const GUEST_TYPE_SET = new Set<string>(GUEST_TYPES);

/**
 * Validates a single guest row against the shared field rules. Returns a
 * normalized row on success or a per-row reason on failure. Reasons never echo
 * the offending value (PII) — they name the field and the rule.
 */
function validateGuestRow(
  row: GuestImportRow,
):
  | {ok: true; name: string; email?: string; type: GuestType; notes?: string}
  | {ok: false; reason: string} {
  const name = row.name.trim();
  if (name.length === 0) {
    return {ok: false, reason: 'name is required'};
  }
  if (name.length > MAX_GUEST_NAME_LENGTH) {
    return {
      ok: false,
      reason: `name exceeds ${MAX_GUEST_NAME_LENGTH} characters`,
    };
  }

  const email = row.email?.trim() ? row.email.trim() : undefined;
  if (email !== undefined) {
    if (email.length > MAX_GUEST_EMAIL_LENGTH) {
      return {
        ok: false,
        reason: `email exceeds ${MAX_GUEST_EMAIL_LENGTH} characters`,
      };
    }
    if (!emailHasAtSign(email)) {
      return {ok: false, reason: 'email is invalid'};
    }
  }

  const notes = row.notes?.trim() ? row.notes.trim() : undefined;
  if (notes !== undefined && notes.length > MAX_GUEST_NOTES_LENGTH) {
    return {
      ok: false,
      reason: `notes exceed ${MAX_GUEST_NOTES_LENGTH} characters`,
    };
  }

  const rawType = row.type?.trim();
  let type: GuestType;
  if (!rawType) {
    // Missing type column or empty cell defaults to `guest`.
    type = 'guest';
  } else if (GUEST_TYPE_SET.has(rawType)) {
    type = rawType as GuestType;
  } else {
    return {ok: false, reason: 'invalid guest type'};
  }

  return {ok: true, name, email, type, notes};
}

/**
 * Bulk-adds guests from a parsed CSV. Guests always flag+skip duplicates
 * (no include mode). Duplicate detection is name+email case-insensitive within
 * the batch and against existing guests. Idempotent under retry: a replayed
 * batch key is a no-op returning the original result. Writes exactly one
 * batch-level audit entry.
 */
export async function addMany(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    batchKey: string;
    rows: GuestImportRow[];
  },
): Promise<ImportBatchResult> {
  const {user, event} = await requireEventForEdit(ctx, args.eventId);

  // Idempotent replay: return the original result without writing anything.
  const existingBatch = await findExistingImportBatch(
    ctx,
    args.eventId,
    args.batchKey,
    'guests',
  );
  if (existingBatch) {
    return existingBatch.result;
  }

  assertBatchSizeWithinCap(args.rows.length);

  // Existing guest dedup keys (name+email, case-insensitive).
  const existingKeys = new Set<string>();
  for await (const guest of ctx.db
    .query('guests')
    .withIndex('by_event', (q) => q.eq('eventId', args.eventId))) {
    existingKeys.add(nameEmailDedupKey(guest.name, guest.email));
  }

  const seenInBatch = new Set<string>();
  const outcomes: ImportRowOutcome[] = [];
  let insertedCount = 0;
  let skippedCount = 0;

  for (let rowIndex = 0; rowIndex < args.rows.length; rowIndex += 1) {
    const validated = validateGuestRow(args.rows[rowIndex]);
    if (!validated.ok) {
      outcomes.push({rowIndex, status: 'invalid', reason: validated.reason});
      continue;
    }

    const key = nameEmailDedupKey(validated.name, validated.email);
    if (existingKeys.has(key) || seenInBatch.has(key)) {
      skippedCount += 1;
      outcomes.push({
        rowIndex,
        status: 'skipped',
        reason: 'duplicate name and email',
      });
      continue;
    }
    seenInBatch.add(key);

    await ctx.db.insert('guests', {
      eventId: args.eventId,
      name: validated.name,
      ...(validated.email !== undefined ? {email: validated.email} : {}),
      type: validated.type,
      ...(validated.notes !== undefined ? {notes: validated.notes} : {}),
    });
    insertedCount += 1;
    outcomes.push({rowIndex, status: 'inserted'});
  }

  const result: ImportBatchResult = {insertedCount, skippedCount, outcomes};

  await insertImportBatch(ctx, {
    eventId: args.eventId,
    batchKey: args.batchKey,
    target: 'guests',
    result,
  });

  // ONE batch-level audit entry (never one per row). PII stays out of the
  // payload — `reason` carries counts and the batch key only.
  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: user._id,
      action: ADMIN_AUDIT_ACTIONS.GUEST_IMPORT,
      eventId: args.eventId,
      organizerId: event.organizerId,
      reason: `batch ${args.batchKey}: ${insertedCount} added, ${skippedCount} skipped`,
      source: 'admin-ui',
    },
  );

  return result;
}
