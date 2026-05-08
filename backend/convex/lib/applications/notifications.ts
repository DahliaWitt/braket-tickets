import type {Doc} from '../../_generated/dataModel';
import {
  applicationApprovedTemplate,
  applicationRejectedTemplate,
} from '../../email/templates';

type DecisionStatus = Extract<
  Doc<'applications'>['status'],
  'approved' | 'rejected'
>;

export interface ApplicationDecisionEmailPayload {
  to: string;
  subject: string;
  html: string;
}

export function buildApplicationDecisionEmail(args: {
  status: DecisionStatus;
  recipient: Pick<Doc<'users'>, 'email' | 'name'> | null;
  communityName?: string;
  communityParam?: string;
  denyReason?: string;
}): ApplicationDecisionEmailPayload | null {
  if (!args.recipient?.email) return null;

  if (args.status === 'approved') {
    const {subject, html} = applicationApprovedTemplate(
      args.recipient.name || 'friend',
      args.communityName,
      args.communityParam,
    );
    return {
      to: args.recipient.email,
      subject,
      html,
    };
  }

  const {subject, html} = applicationRejectedTemplate(
    args.recipient.name || 'friend',
    args.denyReason,
    args.communityName,
  );
  return {
    to: args.recipient.email,
    subject,
    html,
  };
}
