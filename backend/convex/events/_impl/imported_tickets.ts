import {internal} from '../../_generated/api';
import type {Doc, Id} from '../../_generated/dataModel';
import type {MutationCtx, QueryCtx} from '../../_generated/server';
import {
  canEditEvent,
  canScanEvent,
  requireEventForEdit,
  requireEventForRoster,
} from '../../lib/access';
import {requireUser} from '../../lib/auth_identity';
import {ADMIN_AUDIT_ACTIONS} from '../../lib/admin_audit_actions';
import {insertAdminAuditLog} from '../../lib/admin_audit_log';
import {throwNotFound} from '../../lib/errors';
import {loadManagementDatasetWithinLimit} from '../../lib/management_limits';
import {
  MAX_IMPORTED_EMAIL_LENGTH,
  MAX_IMPORTED_LABEL_LENGTH,
  MAX_IMPORTED_NAME_LENGTH,
  MAX_IMPORTED_PURCHASE_DATE_LENGTH,
  emailHasAtSign,
  normalizeEmailOrNull,
} from '../../lib/validation';
import {
  MAX_IMPORT_BATCH_SIZE,
  MAX_IMPORTED_ENTRIES_PER_EVENT,
  assertBatchSizeWithinCap,
  assertEventImportCapNotExceeded,
  findExistingImportBatch,
  insertImportBatch,
  normalizeExternalRefKey,
} from '../../lib/imports/bulk';
import type {
  ImportBatchResult,
  ImportDedupMode,
  ImportRowOutcome,
} from '../../lib/imports/validators';

const DEFAULT_SOURCE_LABEL = 'External';

/** One raw external ticket-holder row from the parsed CSV. */
export type ImportedTicketRow = {
  name: string;
  email?: string;
  externalRef?: string;
  orderRef?: string;
  ticketTypeLabel?: string;
  purchaseDateRaw?: string;
};

type NormalizedImportedRow = {
  name: string;
  email?: string;
  externalRef?: string;
  orderRef?: string;
  ticketTypeLabel?: string;
  purchaseDateRaw?: string;
};

function trimmedOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Validates one imported row. Every string is untrusted (buyer names are
 * attacker-controllable on the external platform), so each field is length
 * capped. Only NAME is required; email is optional but must contain `@` when
 * present. Reasons never echo the value (PII).
 */
function validateImportedRow(
  row: ImportedTicketRow,
): {ok: true; row: NormalizedImportedRow} | {ok: false; reason: string} {
  const name = row.name.trim();
  if (name.length === 0) {
    return {ok: false, reason: 'name is required'};
  }
  if (name.length > MAX_IMPORTED_NAME_LENGTH) {
    return {
      ok: false,
      reason: `name exceeds ${MAX_IMPORTED_NAME_LENGTH} characters`,
    };
  }

  const email = trimmedOrUndefined(row.email);
  if (email !== undefined) {
    if (email.length > MAX_IMPORTED_EMAIL_LENGTH) {
      return {
        ok: false,
        reason: `email exceeds ${MAX_IMPORTED_EMAIL_LENGTH} characters`,
      };
    }
    if (!emailHasAtSign(email)) {
      return {ok: false, reason: 'email is invalid'};
    }
  }

  const externalRef = trimmedOrUndefined(row.externalRef);
  if (
    externalRef !== undefined &&
    externalRef.length > MAX_IMPORTED_LABEL_LENGTH
  ) {
    return {
      ok: false,
      reason: `barcode exceeds ${MAX_IMPORTED_LABEL_LENGTH} characters`,
    };
  }

  const orderRef = trimmedOrUndefined(row.orderRef);
  if (orderRef !== undefined && orderRef.length > MAX_IMPORTED_LABEL_LENGTH) {
    return {
      ok: false,
      reason: `order reference exceeds ${MAX_IMPORTED_LABEL_LENGTH} characters`,
    };
  }

  const ticketTypeLabel = trimmedOrUndefined(row.ticketTypeLabel);
  if (
    ticketTypeLabel !== undefined &&
    ticketTypeLabel.length > MAX_IMPORTED_LABEL_LENGTH
  ) {
    return {
      ok: false,
      reason: `ticket type exceeds ${MAX_IMPORTED_LABEL_LENGTH} characters`,
    };
  }

  const purchaseDateRaw = trimmedOrUndefined(row.purchaseDateRaw);
  if (
    purchaseDateRaw !== undefined &&
    purchaseDateRaw.length > MAX_IMPORTED_PURCHASE_DATE_LENGTH
  ) {
    return {
      ok: false,
      reason: `purchase date exceeds ${MAX_IMPORTED_PURCHASE_DATE_LENGTH} characters`,
    };
  }

  return {
    ok: true,
    row: {
      name,
      email,
      externalRef,
      orderRef,
      ticketTypeLabel,
      purchaseDateRaw,
    },
  };
}

function resolveSourceLabel(sourceLabel: string | undefined): string {
  const trimmed = sourceLabel?.trim();
  if (!trimmed) return DEFAULT_SOURCE_LABEL;
  return trimmed.slice(0, MAX_IMPORTED_LABEL_LENGTH);
}

/**
 * Imports external ticket holders. Barcode (externalRef) is the only strong
 * dedup key and is matched via per-row point lookups on the
 * (event, externalRef) index — never a JS filter over a collected table.
 * Dedup compares ONLY against previously imported entries for this event, never
 * against native purchases. Name+email matches are NEVER auto-skipped (a
 * multi-ticket order legitimately shares name+email); they are surfaced in the
 * preview, not here. Idempotent under retry via batch key; cumulative per-event
 * cap enforced; ONE batch-level audit entry.
 */
export async function importBatch(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    batchKey: string;
    dedupMode: ImportDedupMode;
    sourceLabel?: string;
    rows: ImportedTicketRow[];
  },
): Promise<ImportBatchResult> {
  const {user, event} = await requireEventForEdit(ctx, args.eventId);

  const existingBatch = await findExistingImportBatch(
    ctx,
    args.eventId,
    args.batchKey,
    'importedTickets',
  );
  if (existingBatch) {
    return existingBatch.result;
  }

  assertBatchSizeWithinCap(args.rows.length);

  const sourceLabel = resolveSourceLabel(args.sourceLabel);

  // Validate every row first so the cap check sees the true insert count.
  const validatedRows: Array<
    | {rowIndex: number; ok: true; row: NormalizedImportedRow}
    | {rowIndex: number; ok: false; reason: string}
  > = args.rows.map((row, rowIndex) => {
    const validated = validateImportedRow(row);
    return validated.ok
      ? {rowIndex, ok: true, row: validated.row}
      : {rowIndex, ok: false, reason: validated.reason};
  });

  // Determine which valid rows survive barcode dedup. Cross-import dedup uses
  // point lookups on the (event, externalRef) index; within-batch barcode dupes
  // follow the same mode.
  const seenBarcodesInBatch = new Set<string>();
  const outcomes: ImportRowOutcome[] = [];
  const toInsert: Array<{rowIndex: number; row: NormalizedImportedRow}> = [];

  for (const entry of validatedRows) {
    if (!entry.ok) {
      outcomes.push({
        rowIndex: entry.rowIndex,
        status: 'invalid',
        reason: entry.reason,
      });
      continue;
    }

    const barcode = entry.row.externalRef;
    // Dedup on the normalized (case-insensitive) barcode key so `ABC123` and
    // `abc123` never produce two admission records — matching the UI's strong
    // duplicate key and the scanner's lookup.
    const barcodeKey =
      barcode !== undefined ? normalizeExternalRefKey(barcode) : undefined;
    if (args.dedupMode === 'skip' && barcodeKey !== undefined) {
      if (seenBarcodesInBatch.has(barcodeKey)) {
        outcomes.push({
          rowIndex: entry.rowIndex,
          status: 'skipped',
          reason: 'duplicate barcode in batch',
        });
        continue;
      }
      const existing = await ctx.db
        .query('importedTicketHolders')
        .withIndex('by_event_external_ref_key', (q) =>
          q.eq('eventId', args.eventId).eq('externalRefKey', barcodeKey),
        )
        .first();
      if (existing) {
        outcomes.push({
          rowIndex: entry.rowIndex,
          status: 'skipped',
          reason: 'duplicate barcode',
        });
        continue;
      }
    }

    if (barcodeKey !== undefined) {
      seenBarcodesInBatch.add(barcodeKey);
    }
    toInsert.push({rowIndex: entry.rowIndex, row: entry.row});
  }

  // Cumulative per-event cap (counts only rows that will actually be written).
  const existingCount = await countImportedEntries(ctx, args.eventId);
  assertEventImportCapNotExceeded(existingCount, toInsert.length);

  for (const {rowIndex, row} of toInsert) {
    await ctx.db.insert('importedTicketHolders', {
      eventId: args.eventId,
      name: row.name,
      ...(row.email !== undefined ? {email: row.email} : {}),
      ...(row.externalRef !== undefined
        ? {
            externalRef: row.externalRef,
            externalRefKey: normalizeExternalRefKey(row.externalRef),
          }
        : {}),
      ...(row.orderRef !== undefined ? {orderRef: row.orderRef} : {}),
      ...(row.ticketTypeLabel !== undefined
        ? {ticketTypeLabel: row.ticketTypeLabel}
        : {}),
      ...(row.purchaseDateRaw !== undefined
        ? {purchaseDateRaw: row.purchaseDateRaw}
        : {}),
      sourceLabel,
      batchKey: args.batchKey,
    });
    outcomes.push({rowIndex, status: 'inserted'});
  }

  outcomes.sort((a, b) => a.rowIndex - b.rowIndex);

  const insertedCount = toInsert.length;
  const skippedCount = outcomes.filter((o) => o.status === 'skipped').length;
  const result: ImportBatchResult = {insertedCount, skippedCount, outcomes};

  await insertImportBatch(ctx, {
    eventId: args.eventId,
    batchKey: args.batchKey,
    target: 'importedTickets',
    result,
  });

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: user._id,
      action: ADMIN_AUDIT_ACTIONS.IMPORTED_TICKETS_IMPORT,
      eventId: args.eventId,
      organizerId: event.organizerId,
      reason: `batch ${args.batchKey}: ${insertedCount} imported, ${skippedCount} skipped (${args.dedupMode})`,
      source: 'admin-ui',
    },
  );

  return result;
}

/**
 * Counts imported entries for an event via the by_event index, bounded by the
 * per-event cap so the read cost stays predictable.
 */
async function countImportedEntries(
  ctx: MutationCtx,
  eventId: Id<'events'>,
): Promise<number> {
  let count = 0;
  for await (const _entry of ctx.db
    .query('importedTicketHolders')
    .withIndex('by_event', (q) => q.eq('eventId', eventId))) {
    count += 1;
  }
  return count;
}

/** Removes a single imported entry. Requires event edit access; audit-logged. */
export async function removeEntry(
  ctx: MutationCtx,
  args: {id: Id<'importedTicketHolders'>},
): Promise<null> {
  const entry = await ctx.db.get('importedTicketHolders', args.id);
  if (!entry) throwNotFound('Imported ticket holder');

  const {user, event} = await requireEventForEdit(ctx, entry.eventId);

  await ctx.db.delete('importedTicketHolders', args.id);

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: user._id,
      action: ADMIN_AUDIT_ACTIONS.IMPORTED_TICKETS_REMOVE,
      eventId: entry.eventId,
      organizerId: event.organizerId,
      reason: `removed 1 imported entry${entry.checkedInAt ? ' (checked in)' : ''}`,
      source: 'admin-ui',
    },
  );
  return null;
}

/**
 * Removes an entire import batch by its batch key. Allowed even when the batch
 * contains checked-in entries; the audit entry records the checked-in count and
 * derived door totals drop accordingly. Requires event edit access.
 */
export async function removeBatch(
  ctx: MutationCtx,
  args: {eventId: Id<'events'>; batchKey: string},
): Promise<{removedCount: number; checkedInCount: number}> {
  const {user, event} = await requireEventForEdit(ctx, args.eventId);

  let removedCount = 0;
  let checkedInCount = 0;
  // A batch never exceeds the import batch cap (one file = one batch key), so a
  // single bounded read + delete stays well inside transaction limits.
  const entries = await ctx.db
    .query('importedTicketHolders')
    .withIndex('by_event_batch_key', (q) =>
      q.eq('eventId', args.eventId).eq('batchKey', args.batchKey),
    )
    .take(MAX_IMPORT_BATCH_SIZE);

  for (const entry of entries) {
    if (entry.checkedInAt) checkedInCount += 1;
    await ctx.db.delete('importedTicketHolders', entry._id);
    removedCount += 1;
  }

  // Also drop the batch record so the batch key can no longer replay. Scoped to
  // the imported-tickets target so removal never deletes a guest batch record
  // that happens to share the batch key.
  const batch = await findExistingImportBatch(
    ctx,
    args.eventId,
    args.batchKey,
    'importedTickets',
  );
  if (batch) {
    await ctx.db.delete('importBatches', batch._id);
  }

  await insertAdminAuditLog(
    {db: ctx.db},
    {
      adminId: user._id,
      action: ADMIN_AUDIT_ACTIONS.IMPORTED_TICKETS_BATCH_REMOVE,
      eventId: args.eventId,
      organizerId: event.organizerId,
      reason: `batch ${args.batchKey}: removed ${removedCount} entries, ${checkedInCount} checked in`,
      source: 'admin-ui',
    },
  );

  return {removedCount, checkedInCount};
}

/** Reactive list of imported entries for an event. Requires roster access. */
export async function listByEvent(
  ctx: QueryCtx,
  args: {eventId: Id<'events'>},
): Promise<Doc<'importedTicketHolders'>[]> {
  await requireEventForRoster(ctx, args.eventId);

  return await loadManagementDatasetWithinLimit({
    // Imported entries share the guest dataset budget (both are per-event
    // admission rosters capped well below the transaction read ceiling).
    dataset: 'guests',
    load: (limit) =>
      ctx.db
        .query('importedTicketHolders')
        .withIndex('by_event', (q) => q.eq('eventId', args.eventId))
        .take(limit),
  });
}

export type ImportedCheckInResult =
  | {
      success: true;
      alreadyCheckedIn: boolean;
      entry: Doc<'importedTicketHolders'>;
    }
  | {success: false; message: string};

/**
 * Applies the check-in state transition to a single already-authorized entry.
 * The SINGLE source of truth for imported check-in state — both the by-id
 * mutation and the scanner's by-externalRef fallback call this so the
 * idempotency / audit / patch logic never diverges. Idempotent: an
 * already-checked-in entry returns its existing state (feeding the
 * duplicate-scan warning) without re-patching or re-auditing.
 */
async function applyImportedCheckIn(
  ctx: MutationCtx,
  args: {
    entry: Doc<'importedTicketHolders'>;
    event: Doc<'events'>;
    userId: Id<'users'>;
    isEditor: boolean;
  },
): Promise<ImportedCheckInResult> {
  const {entry, event, userId, isEditor} = args;

  if (entry.checkedInAt) {
    // Idempotent: return existing state without re-patching.
    return {success: true, alreadyCheckedIn: true, entry};
  }

  const checkedInAt = Date.now();
  await ctx.db.patch('importedTicketHolders', entry._id, {
    checkedInAt,
    checkedInBy: userId,
  });

  await ctx.scheduler.runAfter(
    0,
    internal.communities.management.audit.recordCheckIn,
    {
      adminId: userId,
      action: ADMIN_AUDIT_ACTIONS.IMPORTED_TICKET_CHECK_IN,
      eventId: entry.eventId,
      organizerId: event.organizerId,
      source: isEditor ? 'admin-ui' : 'door-scanner',
    },
  );

  return {
    success: true,
    alreadyCheckedIn: false,
    entry: {...entry, checkedInAt, checkedInBy: userId},
  };
}

/**
 * Checks in an imported entry by id. Uses the same door-staff / scan
 * authorization as native ticket check-in (via lib/access). Idempotent via
 * {@link applyImportedCheckIn}.
 */
export async function checkIn(
  ctx: MutationCtx,
  args: {id: Id<'importedTicketHolders'>},
): Promise<ImportedCheckInResult> {
  const user = await requireUser(ctx);
  const userId = user._id;

  const entry = await ctx.db.get('importedTicketHolders', args.id);
  if (!entry) {
    return {success: false, message: 'Imported ticket not found'};
  }

  const event = await ctx.db.get('events', entry.eventId);
  if (!event) {
    return {success: false, message: 'Imported ticket not found'};
  }

  const [canScan, isEditor] = await Promise.all([
    canScanEvent(ctx, userId, event),
    canEditEvent(ctx, userId, event),
  ]);
  if (!canScan) {
    return {success: false, message: 'Imported ticket not found'};
  }

  return applyImportedCheckIn(ctx, {entry, event, userId, isEditor});
}

export type ResolveImportedByRefResult =
  | {matched: false}
  | {matched: true; result: ImportedCheckInResult};

/**
 * Scanner external fallback. Exact-matches the trimmed payload against
 * importedTicketHolders.externalRef for a SINGLE event (point lookup on
 * by_event_external_ref). External references never resolve across events —
 * acceptance is limited to the scanned event's imported set, so a forged code
 * is contained by duplicate-scan protection.
 *
 * When "include duplicates" imports created multiple entries sharing one
 * barcode, the first NOT-yet-checked-in entry in creation order (ascending
 * _creationTime, the index's natural order) is checked in; once all are checked
 * in, the earliest entry is returned so the caller warns as already-checked-in.
 *
 * Authorization mirrors native check-in (scan capability via lib/access); the
 * caller (native scan-resolution path) has already resolved the event and its
 * scan authorization, but this helper re-verifies so it is safe to call
 * standalone. Returns `{matched: false}` when no entry matches so the caller
 * keeps the existing invalid-ticket behavior.
 */
export async function resolveAndCheckInByExternalRef(
  ctx: MutationCtx,
  args: {
    eventId: Id<'events'>;
    externalRef: string;
    userId: Id<'users'>;
  },
): Promise<ResolveImportedByRefResult> {
  // Normalize the scanned payload the same way imports do, so a barcode's case
  // never causes a miss at the door.
  const externalRefKey = normalizeExternalRefKey(args.externalRef);
  if (externalRefKey.length === 0) {
    return {matched: false};
  }

  // Authorize BEFORE reading the imported set (repo pattern: authz-before-read).
  // An unauthorized caller never touches the imported table.
  const event = await ctx.db.get('events', args.eventId);
  if (!event) {
    return {matched: false};
  }
  const [canScan, isEditor] = await Promise.all([
    canScanEvent(ctx, args.userId, event),
    canEditEvent(ctx, args.userId, event),
  ]);
  if (!canScan) {
    // Contained: an unauthorized caller learns nothing about the imported set.
    return {matched: false};
  }

  // Point lookup scoped to the scanned event only. `by_event_external_ref_key`
  // returns entries in creation order for a shared barcode. Bounded by the
  // per-event import cap: entries sharing one barcode can never exceed the
  // total imported entries for the event.
  const matches = await ctx.db
    .query('importedTicketHolders')
    .withIndex('by_event_external_ref_key', (q) =>
      q.eq('eventId', args.eventId).eq('externalRefKey', externalRefKey),
    )
    .take(MAX_IMPORTED_ENTRIES_PER_EVENT);

  if (matches.length === 0) {
    return {matched: false};
  }

  // Check in the first not-yet-checked-in entry in creation order; if all are
  // checked in, return the earliest so the caller warns as already-checked-in.
  const target = matches.find((m) => m.checkedInAt === undefined) ?? matches[0];

  const result = await applyImportedCheckIn(ctx, {
    entry: target,
    event,
    userId: args.userId,
    isEditor,
  });
  return {matched: true, result};
}

/**
 * Page size for the redaction sweep. Bounds the per-transaction read so a large
 * imported-ticket table cannot blow the Convex read budget mid-privacy-request.
 */
const REDACT_PAGE_SIZE = 200;

/**
 * Operator privacy redaction: redacts imported entries whose email matches the
 * given address (case-insensitive) across ALL events. Name and email are
 * cleared to a tombstone so the personal data no longer persists while the
 * admission record's check-in state and source attribution remain intact.
 * Internal-only (operator process); audit-logged per affected event per page.
 *
 * There is no email index on `importedTicketHolders` (email is optional and
 * stored verbatim), so matching requires a table walk. The walk is PAGINATED
 * and self-reschedules across transactions so the read stays bounded — a
 * privacy request must not fail because the table is large. Redacted rows have
 * their email cleared, so they no longer match `target` and are never
 * re-processed on a later page.
 */
export async function redactByEmail(
  ctx: MutationCtx,
  args: {
    email: string;
    operatorUserId: Id<'users'>;
    cursor?: string | null;
  },
): Promise<{redactedCount: number; isDone: boolean}> {
  const target = normalizeEmailOrNull(args.email);
  if (target === null) {
    return {redactedCount: 0, isDone: true};
  }

  const {page, isDone, continueCursor} = await ctx.db
    .query('importedTicketHolders')
    .paginate({cursor: args.cursor ?? null, numItems: REDACT_PAGE_SIZE});

  let redactedCount = 0;
  const affectedEvents = new Set<Id<'events'>>();

  for (const entry of page) {
    if (normalizeEmailOrNull(entry.email) !== target) continue;
    await ctx.db.patch('importedTicketHolders', entry._id, {
      name: '[redacted]',
      email: undefined,
    });
    redactedCount += 1;
    affectedEvents.add(entry.eventId);
  }

  const eventIds = [...affectedEvents];
  const events = await Promise.all(
    eventIds.map((eventId) => ctx.db.get('events', eventId)),
  );
  for (let i = 0; i < eventIds.length; i += 1) {
    const event = events[i];
    await insertAdminAuditLog(
      {db: ctx.db},
      {
        adminId: args.operatorUserId,
        action: ADMIN_AUDIT_ACTIONS.IMPORTED_TICKETS_REDACT,
        eventId: eventIds[i],
        ...(event ? {organizerId: event.organizerId} : {}),
        reason: 'redacted imported entries matching privacy request',
        source: 'admin-ui',
      },
    );
  }

  if (!isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.events.imported_tickets.redactByEmail,
      {
        email: args.email,
        operatorUserId: args.operatorUserId,
        cursor: continueCursor,
      },
    );
  }

  return {redactedCount, isDone};
}
