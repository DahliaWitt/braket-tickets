import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {form, FormField, maxLength, required} from '@angular/forms/signals';
import {toast} from 'ngx-sonner';
import {injectQuery, skipToken} from 'convex-angular';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
} from '@shared/constants';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {logger} from '@/utils/logger';

@Component({
  selector: 'app-ticket-reminder-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    ZardButtonComponent,
    ZardCardComponent,
    ZardIconComponent,
  ],
  templateUrl: './ticket-reminder-tab.component.html',
})
export class TicketReminderTabComponent {
  private adminEventsService = inject(AdminEventsService);
  private dialogService = inject(BraDialogService);

  readonly eventId = input.required<string>();
  readonly communityId = input.required<string>();
  // Retained for the parent template binding; the live injectQuery subscription below no longer needs a reload token. Removal is deferred — see follow-up note.
  readonly reloadToken = input<number>(0);
  readonly eventTitle = input<string>('');
  readonly dataChanged = output();

  readonly reminderFormModel = signal({subject: '', message: ''});
  readonly maxTicketReminderSubjectLength = MAX_TICKET_REMINDER_SUBJECT_LENGTH;
  readonly maxTicketReminderMessageLength = MAX_TICKET_REMINDER_MESSAGE_LENGTH;

  readonly reminderForm = form(this.reminderFormModel, (f) => {
    required(f.subject);
    required(f.message);
    maxLength(f.subject, MAX_TICKET_REMINDER_SUBJECT_LENGTH, {
      message: `Subject cannot exceed ${MAX_TICKET_REMINDER_SUBJECT_LENGTH} characters`,
    });
    maxLength(f.message, MAX_TICKET_REMINDER_MESSAGE_LENGTH, {
      message: `Message cannot exceed ${MAX_TICKET_REMINDER_MESSAGE_LENGTH} characters`,
    });
  });

  readonly reminderAudienceQuery = injectQuery(
    api.events.reminders.getTicketReminderAudience,
    () => {
      const eventId = this.eventId();
      return eventId ? {eventId: eventId as Id<'events'>} : skipToken;
    },
  );

  readonly reminderAudience = computed(
    () => this.reminderAudienceQuery.data() ?? null,
  );
  readonly isLoadingReminderAudience = this.reminderAudienceQuery.isLoading;

  readonly reminderSubjectLength = computed(
    () => this.reminderFormModel().subject.length,
  );
  readonly reminderMessageLength = computed(
    () => this.reminderFormModel().message.length,
  );
  readonly reminderSubjectTrimmed = computed(() =>
    this.reminderFormModel().subject.trim(),
  );
  readonly reminderMessageTrimmed = computed(() =>
    this.reminderFormModel().message.trim(),
  );

  readonly reminderRecipientCount = computed(
    () => this.reminderAudience()?.recipientCount ?? 0,
  );
  readonly reminderAudienceError = computed(() => {
    const error = this.reminderAudienceQuery.error();
    if (!error) return null;
    return error instanceof Error && error.message
      ? `couldn't load reminder audience — ${error.message}`
      : "couldn't load reminder audience";
  });
  readonly reminderMissingCommunity = computed(
    () => this.reminderAudience()?.missingOrganizer ?? false,
  );
  readonly hasReminderLengthErrors = computed(
    () =>
      this.reminderSubjectLength() > this.maxTicketReminderSubjectLength ||
      this.reminderMessageLength() > this.maxTicketReminderMessageLength,
  );
  readonly isSendReminderDisabled = computed(
    () =>
      !this.eventId() ||
      this.isSendingTicketReminder() ||
      this.isLoadingReminderAudience() ||
      !!this.reminderAudienceError() ||
      this.reminderMissingCommunity() ||
      this.reminderRecipientCount() === 0 ||
      this.hasReminderLengthErrors() ||
      this.reminderForm().invalid() ||
      !this.reminderSubjectTrimmed() ||
      !this.reminderMessageTrimmed(),
  );

  readonly isSendingTicketReminder = signal(false);

  openSendTicketReminderConfirm(): void {
    if (this.isSendReminderDisabled()) return;

    const eventId = this.eventId();
    const recipientCount = this.reminderRecipientCount();
    const recipientLabel = recipientCount === 1 ? 'recipient' : 'recipients';
    const title = this.eventTitle();
    const description = title
      ? `Send this reminder to ${recipientCount} ${recipientLabel} for "${title}"?`
      : `Send this reminder to ${recipientCount} ${recipientLabel}?`;

    this.dialogService.create({
      zTitle: 'Send Ticket Reminder',
      zDescription: description,
      zOkText: 'Send Reminder',
      zCancelText: 'Cancel',
      zOnOk: async () => {
        await this.sendTicketReminder(eventId);
      },
    });
  }

  private async sendTicketReminder(eventId: string): Promise<void> {
    if (this.isSendingTicketReminder()) return;

    const subject = this.reminderSubjectTrimmed();
    const message = this.reminderMessageTrimmed();
    if (!subject || !message) return;

    this.isSendingTicketReminder.set(true);
    try {
      const result = await this.adminEventsService.sendTicketPurchaseReminder(
        eventId,
        subject,
        message,
      );
      const label = result.recipientCount === 1 ? 'recipient' : 'recipients';
      toast.success(`Reminder sent to ${result.recipientCount} ${label}`);
      this.reminderFormModel.set({subject: '', message: ''});
      this.dataChanged.emit();
    } catch (error) {
      logger.error('Failed to send ticket reminder', error);
      const messageText =
        error instanceof Error
          ? error.message
          : 'Failed to send ticket reminder';
      toast.error(messageText);
    } finally {
      this.isSendingTicketReminder.set(false);
    }
  }
}
