import {ConvexError} from 'convex/values';
import {throwAppError} from './errors';

/**
 * Shared dataset limits for event-management read surfaces.
 *
 * Every admin management query loads a bounded slice of a single dataset so
 * a single reactive subscription never exceeds the per-query transaction
 * budget. When a dataset grows past its slice, the query throws
 * `MANAGEMENT_DATA_TOO_LARGE` with the offending dataset and limit so the
 * frontend can surface an explicit "dataset too large" message instead of
 * silently displaying truncated metrics.
 */
export const MANAGEMENT_DATASET_LIMITS = {
  /**
   * `tickets` drives per-tier counts, check-in rates, and per-order summaries
   * on the management dashboard. 10k covers large single-event festivals
   * without forcing the query over the ~16k-doc read ceiling that trips the
   * transaction budget once user / order / tier joins are folded in.
   */
  tickets: 10_000,
  /**
   * `guests` is the manually-added guest list, separate from ticketed buyers.
   * Capped lower than tickets because guest lists are operationally smaller
   * (comp lists, VIP rows) — 5k is ~2× the largest guest list we've seen and
   * keeps the single-query cost predictable.
   */
  guests: 5_000,
  /**
   * `orders` mirrors the ticket cap: every paid ticket has an order row, so
   * the two scale together. Kept at 10k so an event that stays under the
   * ticket cap cannot silently trip an order-cap mismatch.
   */
  orders: 10_000,
  /**
   * `orderFinancialEvents` records each purchase / refund / chargeback /
   * adjustment per order. Capped at 2× `orders` because a single order can
   * emit multiple events across its lifetime (purchase → partial refund →
   * chargeback) and the revenue rollup must read all of them for accuracy.
   */
  orderFinancialEvents: 20_000,
  /**
   * `resaleListings` are bounded per-event and rarely dense — a cap of 5k is
   * already ~5× the largest resale surge we've seen and keeps the listing +
   * buyer-match read pattern inside the transaction budget.
   */
  resaleListings: 5_000,
  /**
   * `resaleNotifications` are opt-in, sparse records. 1k is generous for the
   * real-world volume; the low cap keeps the listings+notifications twin
   * read under budget even when both are near their individual limits.
   */
  resaleNotifications: 1_000,
} as const;

export const MANAGEMENT_DATA_TOO_LARGE_CODE = 'MANAGEMENT_DATA_TOO_LARGE';

export type ManagementDatasetKey = keyof typeof MANAGEMENT_DATASET_LIMITS;

function formatManagementDatasetLabel(dataset: ManagementDatasetKey): string {
  switch (dataset) {
    case 'tickets':
      return 'tickets';
    case 'guests':
      return 'guests';
    case 'orders':
      return 'orders';
    case 'orderFinancialEvents':
      return 'order financial events';
    case 'resaleListings':
      return 'resale listings';
    case 'resaleNotifications':
      return 'resale notifications';
  }
}

/**
 * Load a bounded slice of a management dataset.
 *
 * The `load` callback MUST apply the received `limit` to its underlying
 * `.take(limit)` call. We ask for `limit + 1` rows and throw the typed
 * ConvexError when the result exceeds the documented cap.
 */
export async function loadManagementDatasetWithinLimit<T>({
  dataset,
  load,
}: {
  dataset: ManagementDatasetKey;
  load: (limit: number) => Promise<T[]>;
}): Promise<T[]> {
  const limit = MANAGEMENT_DATASET_LIMITS[dataset];
  const rows = await load(limit + 1);

  if (rows.length > limit) {
    throwAppError(
      MANAGEMENT_DATA_TOO_LARGE_CODE,
      `Event management ${formatManagementDatasetLabel(dataset)} exceed ` +
        `the supported limit of ${limit} records. Admin metrics would be incomplete, ` +
        'so loading has been blocked.',
      {dataset, limit},
    );
  }

  return rows;
}

type DatasetLoaders = Record<string, () => Promise<unknown>>;

type DatasetResults<T extends DatasetLoaders> = {
  [K in keyof T]: Awaited<ReturnType<T[K]>>;
};

function isManagementTooLargeError(err: unknown): err is ConvexError<{
  code: typeof MANAGEMENT_DATA_TOO_LARGE_CODE;
  dataset: ManagementDatasetKey;
  limit: number;
  message: string;
}> {
  return (
    err instanceof ConvexError &&
    typeof err.data === 'object' &&
    err.data !== null &&
    (err.data as {code?: unknown}).code === MANAGEMENT_DATA_TOO_LARGE_CODE
  );
}

/**
 * Run a record of management dataset loaders concurrently. Replaces a naive
 * `Promise.all([...])` at each management call site.
 *
 * `Promise.all` rejects on the first failure and abandons the rest, so an
 * oversized event only reports ONE offending dataset per query round-trip.
 * Operators pruning data then hit the next dataset's limit on the next
 * refresh, which is a poor loop.
 *
 * This helper uses `allSettled` to let every loader surface its own result,
 * then aggregates the verdict:
 *  - Any non-`MANAGEMENT_DATA_TOO_LARGE` rejection wins and is rethrown
 *    verbatim (preserving the original error shape for db errors, etc.).
 *    The first such rejection wins; aggregation semantics only apply to
 *    the dataset-too-large class.
 *  - Exactly one dataset-too-large rejection rethrows the original error
 *    verbatim, so single-dataset callers keep their existing error shape
 *    (dataset + limit + message fields) and existing tests stay green.
 *  - Two or more dataset-too-large rejections aggregate into a single
 *    `MANAGEMENT_DATA_TOO_LARGE` ConvexError whose `message` lists every
 *    offending dataset with its limit, so operators get the full punch
 *    list in one response instead of whack-a-mole.
 *  - All loaders fulfilled: resolve with a typed record of their results.
 */
export async function runManagementDatasetLoaders<T extends DatasetLoaders>(
  loaders: T,
): Promise<DatasetResults<T>> {
  const entries = Object.entries(loaders) as Array<
    [keyof T & string, T[keyof T]]
  >;
  const settled = await Promise.allSettled(
    entries.map(([, loader]) => loader()),
  );

  const datasetViolations: Array<{
    dataset: ManagementDatasetKey;
    limit: number;
  }> = [];
  let firstOtherRejection: unknown = null;
  let firstDatasetRejection: unknown = null;

  for (const result of settled) {
    if (result.status === 'fulfilled') continue;
    if (isManagementTooLargeError(result.reason)) {
      if (firstDatasetRejection === null) firstDatasetRejection = result.reason;
      datasetViolations.push({
        dataset: result.reason.data.dataset,
        limit: result.reason.data.limit,
      });
      continue;
    }
    if (firstOtherRejection === null) firstOtherRejection = result.reason;
  }

  if (firstOtherRejection !== null) throw firstOtherRejection;

  if (datasetViolations.length === 1) {
    // Single-dataset case: preserve byte-identical error shape. Tests and
    // frontend extractors that inspect {dataset, limit} continue working
    // unchanged.
    throw firstDatasetRejection;
  }

  if (datasetViolations.length > 1) {
    const summary = datasetViolations
      .map(
        (v) => `${formatManagementDatasetLabel(v.dataset)} (limit ${v.limit})`,
      )
      .join(', ');
    throwAppError(
      MANAGEMENT_DATA_TOO_LARGE_CODE,
      `Event management data exceeds supported limits for: ${summary}. ` +
        'Admin metrics would be incomplete, so loading has been blocked.',
      {datasets: datasetViolations},
    );
  }

  const out = {} as DatasetResults<T>;
  for (let index = 0; index < entries.length; index += 1) {
    const [key] = entries[index];
    out[key] = (
      settled[index] as PromiseFulfilledResult<Awaited<ReturnType<T[keyof T]>>>
    ).value;
  }
  return out;
}
