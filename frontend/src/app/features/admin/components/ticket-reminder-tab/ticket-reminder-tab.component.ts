import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {form, FormField, maxLength, required} from '@angular/forms/signals';
import {
  RichTextEditorComponent,
  type RichTextImageUploadFn,
} from '../rich-text-editor/rich-text-editor.component';
import {toast} from 'ngx-sonner';
import {injectQuery, skipToken} from 'convex-angular';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {EventsService} from '@/features/admin/services/events.service';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
} from '@shared/constants';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {logger} from '@/utils/logger';

@Component({
  selector: 'app-ticket-reminder-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    RichTextEditorComponent,
    ZardButtonComponent,
    ZardCardComponent,
    ZardInputDirective,
    ZardIconComponent,
  ],
  templateUrl: './ticket-reminder-tab.component.html',
})
export class TicketReminderTabComponent {
  private adminEventsService = inject(AdminEventsService);
  private dialogService = inject(BraDialogService);
  private eventsService = inject(EventsService);

  /**
   * Inline-image uploader handed to the rich-text editor. Bound to this instance
   * so the editor can enable its image button and stream uploads through Convex
   * storage, resolving to the confirmed `storageId` (persisted into the email
   * body) plus a signed preview url (display-only).
   */
  readonly imageUpload: RichTextImageUploadFn = async (file, onProgress) => {
    const {storageId, url} = await this.eventsService.uploadRichTextImage(
      file,
      onProgress,
    );
    return {storageId, previewUrl: url};
  };

  readonly eventId = input.required<string>();
  readonly communityId = input.required<string>();
  // Retained for the parent template binding; the live injectQuery subscription below no longer needs a reload token. Removal is deferred — see follow-up note.
  readonly reloadToken = input<number>(0);
  readonly eventTitle = input<string>('');
  readonly dataChanged = output();

  /**
   * Compose state. `subject` is bound to the subject input; `message` mirrors the
   * rich-text editor's best-effort plaintext (drives required + length checks and
   * is sent as the fallback text part); `bodyJson` is the serialized ProseMirror
   * document the backend renders and re-derives its canonical plaintext from.
   */
  readonly reminderFormModel = signal({subject: '', message: '', bodyJson: ''});
  readonly maxTicketReminderSubjectLength = MAX_TICKET_REMINDER_SUBJECT_LENGTH;
  readonly maxTicketReminderMessageLength = MAX_TICKET_REMINDER_MESSAGE_LENGTH;

  private readonly bodyEditor = viewChild(RichTextEditorComponent);

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

  /** Mirrors the editor's serialized ProseMirror JSON into the compose state. */
  onBodyJsonChange(bodyJson: string): void {
    this.reminderFormModel.update((model) => ({...model, bodyJson}));
  }

  /** Mirrors the editor's best-effort plaintext into the compose state. */
  onBodyTextChange(message: string): void {
    this.reminderFormModel.update((model) => ({...model, message}));
  }

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
    const bodyJson = this.reminderFormModel().bodyJson;
    if (!subject || !message) return;

    this.isSendingTicketReminder.set(true);
    try {
      // Backend re-derives the canonical plaintext from bodyJson; the trimmed
      // message is sent as a best-effort fallback for the text part.
      const result = await this.adminEventsService.sendTicketPurchaseReminder(
        eventId,
        subject,
        message,
        bodyJson,
      );
      const label = result.recipientCount === 1 ? 'recipient' : 'recipients';
      toast.success(`Reminder sent to ${result.recipientCount} ${label}`);
      this.resetComposeState();
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

  /** Clears the editor document and compose fields after a successful send. */
  private resetComposeState(): void {
    this.bodyEditor()?.getEditor()?.commands.clearContent(true);
    this.reminderFormModel.set({subject: '', message: '', bodyJson: ''});
  }
}
