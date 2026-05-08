import type {Id} from '../../_generated/dataModel';
import type {MutationCtx} from '../../_generated/server';
import {vettingSubmissionTemplate} from '../../email/templates';
import {canManageCommunity} from '../../lib/access';

type ApplicationsMutationCtx = MutationCtx;

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
  const immediatePreferences = await ctx.db
    .query('adminNotificationPreferences')
    .withIndex('by_organizer_and_mode', (query) =>
      query.eq('organizerId', args.organizerId).eq('mode', 'all'),
    )
    .collect();
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
