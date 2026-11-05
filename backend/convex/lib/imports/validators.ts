/**
 * Shared validators and return-shape fragments for the bulk CSV import
 * pipeline. Both import targets (guest bulk-add and external ticket-holder
 * import) return the same structured, validator-typed result so the frontend
 * consumes one contract via the generated API.
 */
import {v} from 'convex/values';

export const IMPORT_TARGETS = [
  'guests',
  'importedTickets',
  'assignmentStaff',
] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export const importTargetValidator = v.union(
  v.literal(IMPORT_TARGETS[0]),
  v.literal(IMPORT_TARGETS[1]),
  v.literal(IMPORT_TARGETS[2]),
);

/**
 * Per-row outcome status.
 * - `inserted`: the row passed validation and was written.
 * - `skipped`: the row was valid but a duplicate under the active dedup rule.
 * - `invalid`: the row failed validation (a per-row `reason` explains why).
 */
export const IMPORT_ROW_STATUSES = ['inserted', 'skipped', 'invalid'] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

export const importRowOutcomeValidator = v.object({
  rowIndex: v.number(),
  status: v.union(
    v.literal('inserted'),
    v.literal('skipped'),
    v.literal('invalid'),
  ),
  reason: v.optional(v.string()),
});

export type ImportRowOutcome = {
  rowIndex: number;
  status: ImportRowStatus;
  reason?: string;
};

export const importBatchResultValidator = v.object({
  insertedCount: v.number(),
  skippedCount: v.number(),
  outcomes: v.array(importRowOutcomeValidator),
});

export type ImportBatchResult = {
  insertedCount: number;
  skippedCount: number;
  outcomes: ImportRowOutcome[];
};

/** Dedup mode for the external ticket-holder import (buyer target only). */
export const IMPORT_DEDUP_MODES = ['skip', 'include'] as const;
export type ImportDedupMode = (typeof IMPORT_DEDUP_MODES)[number];

export const importDedupModeValidator = v.union(
  v.literal(IMPORT_DEDUP_MODES[0]),
  v.literal(IMPORT_DEDUP_MODES[1]),
);
