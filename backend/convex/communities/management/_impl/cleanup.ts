import type {MutationCtx} from '../../../_generated/server';

const BATCH_SIZE = 500;
const RETENTION_DAYS = 365;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

export async function cleanupOldAuditLogsState(
  ctx: MutationCtx,
  cutoffTimestamp = Date.now() - RETENTION_DAYS * MILLIS_PER_DAY,
): Promise<{deletedCount: number; shouldContinue: boolean}> {
  const logs = await ctx.db.query('adminAuditLogs').order('asc').take(BATCH_SIZE);
  let deletedCount = 0;

  for (const log of logs) {
    if (log._creationTime >= cutoffTimestamp) {
      break;
    }
    await ctx.db.delete('adminAuditLogs', log._id);
    deletedCount += 1;
  }

  return {
    deletedCount,
    shouldContinue:
      logs.length === BATCH_SIZE &&
      logs[logs.length - 1]?._creationTime < cutoffTimestamp,
  };
}
