import type {ActionCtx, MutationCtx, QueryCtx} from '../_generated/server';
import type {DeploymentMetadata, RequestMetadata} from 'convex/server';
import {logger} from './logger';

type AnyMetaCtx = Pick<QueryCtx | MutationCtx | ActionCtx, 'meta'>;
type TransactionMetaCtx = Pick<QueryCtx | MutationCtx, 'meta'>;

export async function getRequestMetadataSafe(
  ctx: AnyMetaCtx,
): Promise<RequestMetadata | null> {
  if (!('getRequestMetadata' in ctx.meta)) {
    return null;
  }
  try {
    return await ctx.meta.getRequestMetadata();
  } catch (error) {
    logger.warn('runtime-metadata', 'Failed to read request metadata', error);
    return null;
  }
}

export async function getRequestIdSafe(
  ctx: AnyMetaCtx,
): Promise<string | undefined> {
  const metadata = await getRequestMetadataSafe(ctx);
  return metadata?.requestId;
}

export async function getDeploymentMetadataSafe(
  ctx: AnyMetaCtx,
): Promise<DeploymentMetadata | null> {
  try {
    return await ctx.meta.getDeploymentMetadata();
  } catch (error) {
    logger.warn(
      'runtime-metadata',
      'Failed to read deployment metadata',
      error,
    );
    return null;
  }
}

export async function getDeploymentNameSafe(
  ctx: AnyMetaCtx,
): Promise<string | undefined> {
  return (await getDeploymentMetadataSafe(ctx))?.name;
}

export async function logTransactionMetrics(
  ctx: TransactionMetaCtx,
  label: string,
): Promise<void> {
  try {
    const metrics = await ctx.meta.getTransactionMetrics();
    logger.info('runtime-metadata', 'Convex transaction metrics', {
      label,
      bytesReadRemaining: metrics.bytesRead.remaining,
      documentsReadRemaining: metrics.documentsRead.remaining,
      databaseQueriesRemaining: metrics.databaseQueries.remaining,
    });
  } catch (error) {
    logger.warn('runtime-metadata', 'Failed to read transaction metrics', {
      label,
      error,
    });
  }
}
