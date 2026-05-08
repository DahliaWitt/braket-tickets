import type {Doc, Id} from '../_generated/dataModel';
import {normalizeEmail} from './validation';

export interface VettingReminderRecipient {
  userId: Id<'users'>;
  email: string;
}

type UserWithEmail = Doc<'users'> & {email: string};

interface BuildRecipientsOptions<TRecipient> {
  excludedUserIds?: ReadonlySet<Id<'users'>>;
  toRecipient: (user: UserWithEmail) => TRecipient;
}

function hasEmail(user: Doc<'users'> | undefined): user is UserWithEmail {
  return typeof user?.email === 'string' && user.email.trim().length > 0;
}

function buildRecipientsFromUserIds<TRecipient>(
  candidateUserIds: Iterable<Id<'users'>>,
  usersById: Map<Id<'users'>, Doc<'users'>>,
  options: BuildRecipientsOptions<TRecipient>,
): TRecipient[] {
  const uniqueUserIds = [...new Set(candidateUserIds)];
  const seenEmails = new Set<string>();
  const recipients: TRecipient[] = [];

  for (const userId of uniqueUserIds) {
    if (options.excludedUserIds?.has(userId)) continue;

    const user = usersById.get(userId);
    if (!hasEmail(user)) continue;

    const normalizedEmail = normalizeEmail(user.email);
    if (seenEmails.has(normalizedEmail)) continue;
    seenEmails.add(normalizedEmail);

    recipients.push(options.toRecipient(user));
  }

  return recipients;
}

export function buildVettingReminderRecipients(
  appliedUserIds: ReadonlySet<Id<'users'>>,
  allUsers: Doc<'users'>[],
): VettingReminderRecipient[] {
  const usersById = new Map<Id<'users'>, Doc<'users'>>(
    allUsers.map((user) => [user._id, user]),
  );

  return buildRecipientsFromUserIds(
    allUsers.map((user) => user._id),
    usersById,
    {
      excludedUserIds: appliedUserIds,
      toRecipient: (user) => ({
        userId: user._id,
        email: user.email,
      }),
    },
  );
}
