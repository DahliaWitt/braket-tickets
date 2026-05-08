import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {form, FormField, maxLength, required} from '@angular/forms/signals';
import {toast} from 'ngx-sonner';
import {AdminRemindersService} from '@/features/admin/services/admin-reminders.service';
import {injectQuery} from 'convex-angular';
import {api} from '@convex/_generated/api';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
} from '@shared/constants';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

@Component({
  selector: 'app-admin-reminders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, ZardButtonComponent, ZardCardComponent, ZardIconComponent],
  templateUrl: './reminders.component.html',
})
export class AdminRemindersComponent {
  private remindersService = inject(AdminRemindersService);
  readonly maxSubjectLength = MAX_TICKET_REMINDER_SUBJECT_LENGTH;
  readonly maxMessageLength = MAX_TICKET_REMINDER_MESSAGE_LENGTH;

  readonly formModel = signal({subject: '', message: ''});

  readonly reminderForm = form(this.formModel, (f) => {
    required(f.subject);
    required(f.message);
    maxLength(f.subject, MAX_TICKET_REMINDER_SUBJECT_LENGTH, {
      message: `Subject cannot exceed ${MAX_TICKET_REMINDER_SUBJECT_LENGTH} characters`,
    });
    maxLength(f.message, MAX_TICKET_REMINDER_MESSAGE_LENGTH, {
      message: `Message cannot exceed ${MAX_TICKET_REMINDER_MESSAGE_LENGTH} characters`,
    });
  });

  readonly audienceQuery = injectQuery(
    api.communities.management.reminders.getVettingReminderAudience,
    () => ({}),
  );

  readonly audience = computed(() => this.audienceQuery.data() ?? null);
  readonly isLoadingAudience = this.audienceQuery.isLoading;
  readonly recipientCount = computed(() => this.audience()?.recipientCount ?? 0);
  readonly audienceError = computed(() => {
    const error = this.audienceQuery.error();
    if (!error) return null;
    return error instanceof Error && error.message
      ? `Failed to load audience: ${error.message}`
      : 'Failed to load audience.';
  });

  readonly subjectLength = computed(() => this.formModel().subject.length);
  readonly messageLength = computed(() => this.formModel().message.length);
  readonly subjectTrimmed = computed(() => this.formModel().subject.trim());
  readonly messageTrimmed = computed(() => this.formModel().message.trim());
  readonly hasLengthErrors = computed(
    () =>
      this.subjectLength() > this.maxSubjectLength ||
      this.messageLength() > this.maxMessageLength,
  );

  readonly isSending = signal(false);

  readonly isSendDisabled = computed(
    () =>
      this.isSending() ||
      this.isLoadingAudience() ||
      !!this.audienceError() ||
      this.recipientCount() === 0 ||
      this.hasLengthErrors() ||
      this.reminderForm().invalid() ||
      !this.subjectTrimmed() ||
      !this.messageTrimmed(),
  );

  async sendReminder(): Promise<void> {
    if (this.isSendDisabled()) return;

    this.isSending.set(true);
    try {
      const result = await this.remindersService.sendVettingReminder(
        this.subjectTrimmed(),
        this.messageTrimmed(),
      );
      toast.success(
        `Vetting reminder sent to ${result.recipientCount} recipients.`,
      );
      this.formModel.set({subject: '', message: ''});
      this.audienceQuery.refetch();
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Unknown error occurred';
      toast.error(`Failed to send reminder: ${msg}`);
    } finally {
      this.isSending.set(false);
    }
  }
}
