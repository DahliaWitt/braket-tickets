import type {Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {vettingSubmissionTemplate} from '../../email/templates';
import {canManageCommunity} from '../../lib/access';
import {logger} from '../../lib/logger';
import {takeFromQuery} from '../../lib/query_scan';

type ApplicationsMutationCtx = MutationCtx;

/**
 * Ceiling on immediate ("all" mode) vetting-notification recipients loaded per
 * application submission. Rows are unique per (admin, organizer) and only
 * community admins can opt in, so real rosters sit in the single digits to
 * tens — but admin count has no hard cap, and each recipient fans out into an
 * authz check, a user read, and an email enqueue inside the submission
 * mutation's transaction. The cap bounds that fan-out so an oversized roster
 * degrades to truncated notifications instead of failing the applicant's
 * submission.
 */
export const MAX_IMMEDIATE_NOTIFICATION_RECIPIENTS = 100;

export interface ApplicationSubmissionEmailPayload {
  recipientUserId: Id<'users'>;
  to: string;
  subject: string;
  html: string;
}

export async function loadApplicationSubmissionEmails(
  ctx: ApplicationsMutationCtx,
  args: {
    applicantUserId: Id<'users'>;
    organizerId: Id<'organizers'>;
  },
): Promise<ApplicationSubmissionEmailPayload[]> {
  // Take cap + 1 so truncation is detectable and logged instead of silent.
  const immediatePreferences = await takeFromQuery(
    ctx.db
      .query('adminNotificationPreferences')
      .withIndex('by_organizer_and_mode', (query) =>
        query.eq('organizerId', args.organizerId).eq('mode', 'all'),
      ),
    MAX_IMMEDIATE_NOTIFICATION_RECIPIENTS + 1,
  );
  if (immediatePreferences.length > MAX_IMMEDIATE_NOTIFICATION_RECIPIENTS) {
    logger.warn(
      'applications',
      'Immediate vetting-notification recipients exceed cap; truncating',
      {
        organizerId: args.organizerId,
        cap: MAX_IMMEDIATE_NOTIFICATION_RECIPIENTS,
      },
    );
    immediatePreferences.length = MAX_IMMEDIATE_NOTIFICATION_RECIPIENTS;
  }
  if (immediatePreferences.length === 0) return [];

  const [adminData, applicant, organizer] = await Promise.all([
    Promise.all(
      immediatePreferences.map(async (preference) => {
        const [canManage, user] = await Promise.all([
          canManageCommunity(ctx, preference.userId, args.organizerId),
          ctx.db.get('users', preference.userId),
        ]);

        return {canManage, preference, user};
      }),
    ),
    ctx.db.get('users', args.applicantUserId),
    ctx.db.get('organizers', args.organizerId),
  ]);

  return adminData.flatMap(({canManage, preference, user}) => {
    if (!canManage || !user?.email) {
      return [];
    }

    const {subject, html} = vettingSubmissionTemplate(
      user.name ?? 'Admin',
      applicant?.name ?? 'Someone',
      Date.now(),
      organizer?.name ?? 'your community',
      organizer?.slug ?? (args.organizerId as string),
    );

    return [
      {
        recipientUserId: preference.userId,
        to: user.email,
        subject,
        html,
      },
    ];
  });
}
