import type {Id} from '../../_generated/dataModel';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
  validateStringLength,
} from '../../lib/validation';
import {throwInvalidInput} from '../../lib/errors';

export function buildTicketReminderDedupKey(args: {
  userId: Id<'users'>;
  eventId: Id<'events'>;
  subject: string;
}): string {
  return `reminder:${args.userId}:${args.eventId}:${args.subject.trim()}`;
}

export function normalizeTicketReminderContent(args: {
  subject: string;
  message: string;
}): {
  subject: string;
  message: string;
} {
  const subject = args.subject.trim();
  const message = args.message.trim();

  if (!subject) throwInvalidInput('Subject is required', {field: 'subject'});
  if (!message) throwInvalidInput('Message is required', {field: 'message'});

  validateStringLength(subject, 'Subject', MAX_TICKET_REMINDER_SUBJECT_LENGTH);
  validateStringLength(message, 'Message', MAX_TICKET_REMINDER_MESSAGE_LENGTH);

  return {subject, message};
}
