import {Doc, Id} from '../_generated/dataModel';
import {throwAppError} from './errors';

export type ApplicationReviewStatus = Extract<
  Doc<'applications'>['status'],
  'approved' | 'rejected'
>;

export type ApplicationTerminalStatus = ApplicationReviewStatus | 'revoked';
export type ApplicationStatus = Doc<'applications'>['status'];

type ApplicationPatch = Pick<
  Doc<'applications'>,
  'status' | 'processedBy' | 'denyReason' | 'reason'
>;

export function assertValidApplicationReviewTransition(
  currentStatus: ApplicationStatus,
): void {
  if (currentStatus === 'pending') return;

  throwAppError(
    'INVALID_STATE',
    `Only pending applications can be reviewed (current status: ${currentStatus})`,
  );
}

export function assertValidApplicationRevocationTransition(
  currentStatus: ApplicationStatus,
): void {
  if (currentStatus === 'approved') return;

  throwAppError(
    'INVALID_STATE',
    `Only approved applications can be revoked (current status: ${currentStatus})`,
  );
}

export function buildApplicationReviewPatch(
  status: ApplicationReviewStatus,
  processedBy: Id<'users'>,
  denyReason?: string,
): ApplicationPatch {
  return {
    status,
    processedBy,
    denyReason: status === 'approved' ? undefined : denyReason,
    // Keep writing `reason` for backward compatibility with existing readers.
    reason: status === 'approved' ? undefined : denyReason,
  };
}

export function buildApplicationRevocationPatch(
  processedBy: Id<'users'>,
  reason?: string,
): ApplicationPatch {
  return {
    status: 'revoked',
    processedBy,
    denyReason: undefined,
    reason,
  };
}

export function assertValidApplicationReinstateTransition(
  currentStatus: ApplicationStatus,
): void {
  if (currentStatus === 'revoked') return;

  throwAppError(
    'INVALID_STATE',
    `Only revoked applications can be reinstated (current status: ${currentStatus})`,
  );
}

export function buildApplicationReinstatePatch(
  processedBy: Id<'users'>,
): ApplicationPatch {
  return {
    status: 'approved',
    processedBy,
    denyReason: undefined,
    reason: undefined,
  };
}
