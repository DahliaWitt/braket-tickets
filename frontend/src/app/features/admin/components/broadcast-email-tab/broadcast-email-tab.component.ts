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
import {DatePipe} from '@angular/common';
import {form, FormField, maxLength, required} from '@angular/forms/signals';
import {toast} from 'ngx-sonner';
import type {FunctionArgs} from 'convex/server';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {
  RichTextEditorComponent,
  type RichTextImageUploadFn,
} from '../rich-text-editor/rich-text-editor.component';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
} from '@shared/constants';
import {injectConvex, injectQueries, skipToken} from 'convex-angular';
import {EventsService} from '@/features/admin/services/events.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardSwitchComponent} from '@ui/components/primitives/switch/switch.component';
import {logger} from '@/utils/logger';

@Component({
  selector: 'app-broadcast-email-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {class: 'block'},
  imports: [
    DatePipe,
    FormField,
    RichTextEditorComponent,
    ZardButtonComponent,
    ZardCardComponent,
    ZardInputDirective,
    ZardIconComponent,
    ZardSwitchComponent,
  ],
  templateUrl: './broadcast-email-tab.component.html',
})
export class BroadcastEmailTabComponent {
  private convex = injectConvex();
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
  readonly reloadToken = input<number>(0);
  readonly eventTitle = input<string>('');
  readonly dataChanged = output();

  readonly maxTicketReminderSubjectLength = MAX_TICKET_REMINDER_SUBJECT_LENGTH;
  readonly maxTicketReminderMessageLength = MAX_TICKET_REMINDER_MESSAGE_LENGTH;

  /**
   * Compose state. `subject` is bound to the subject input; `message` mirrors the
   * rich-text editor's best-effort plaintext (drives required + length checks and
   * is sent as the fallback text part); `bodyJson` is the serialized ProseMirror
   * document the backend renders and re-derives its canonical plaintext from.
   */
  readonly broadcastFormModel = signal({
    subject: '',
    message: '',
    bodyJson: '',
  });

  private readonly bodyEditor = viewChild(RichTextEditorComponent);

  readonly broadcastForm = form(this.broadcastFormModel, (f) => {
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
    this.broadcastFormModel.update((model) => ({...model, bodyJson}));
  }

  /** Mirrors the editor's best-effort plaintext into the compose state. */
  onBodyTextChange(message: string): void {
    this.broadcastFormModel.update((model) => ({...model, message}));
  }

  // include external (imported) ticket holders in the send — defaults ON,
  // mirroring the backend default. Always visible in the compose flow so
  // organizers discover the behavior before they need it.
  readonly includeExternalTicketHolders = signal(true);

  readonly queries = injectQueries(() => {
    const rawEventId = this.eventId();
    const eventId = rawEventId ? (rawEventId as Id<'events'>) : null;
    return {
      audience: eventId
        ? {
            query: api.events.broadcasts.getAudience,
            // Reading the toggle here re-keys the subscription when it flips,
            // so the audience count updates live for the chosen scope.
            args: {
              eventId,
              includeExternalTicketHolders: this.includeExternalTicketHolders(),
            },
          }
        : skipToken,
      history: eventId
        ? {query: api.events.broadcasts.listHistory, args: {eventId}}
        : skipToken,
    };
  });

  readonly broadcastAudience = computed(
    () => this.queries.results().audience ?? null,
  );
  readonly isLoadingBroadcastAudience = computed(
    () => this.queries.statuses().audience === 'pending',
  );
  readonly broadcastRecipientCount = computed(
    () => this.broadcastAudience()?.recipientCount ?? 0,
  );
  readonly broadcastExceedsCap = computed(
    () => this.broadcastAudience()?.exceedsCap ?? false,
  );
  readonly importedReachableCount = computed(
    () => this.broadcastAudience()?.importedReachableCount ?? 0,
  );
  readonly importedUnreachableCount = computed(
    () => this.broadcastAudience()?.importedUnreachableCount ?? 0,
  );
  readonly broadcastAudienceError = computed(() => {
    const error = this.queries.errors().audience;
    if (!error) return null;
    return error instanceof Error && error.message
      ? `couldn't load audience — ${error.message}`
      : "couldn't load audience";
  });

  readonly broadcastHistory = computed(
    () => this.queries.results().history ?? [],
  );
  readonly isLoadingBroadcastHistory = computed(
    () => this.queries.statuses().history === 'pending',
  );
  readonly broadcastHistoryError = computed(() => {
    const error = this.queries.errors().history;
    if (!error) return null;
    return error instanceof Error && error.message
      ? `couldn't load broadcast history — ${error.message}`
      : "couldn't load broadcast history";
  });

  readonly broadcastSubjectLength = computed(
    () => this.broadcastFormModel().subject.length,
  );
  readonly broadcastMessageLength = computed(
    () => this.broadcastFormModel().message.length,
  );
  readonly broadcastSubjectTrimmed = computed(() =>
    this.broadcastFormModel().subject.trim(),
  );
  readonly broadcastMessageTrimmed = computed(() =>
    this.broadcastFormModel().message.trim(),
  );
  readonly hasBroadcastLengthErrors = computed(
    () =>
      this.broadcastSubjectLength() > this.maxTicketReminderSubjectLength ||
      this.broadcastMessageLength() > this.maxTicketReminderMessageLength,
  );

  readonly isSendingBroadcast = signal(false);
  readonly sendFeedback = signal<null | {
    kind: 'success' | 'error';
    message: string;
  }>(null);

  readonly isSendBroadcastDisabled = computed(
    () =>
      !this.eventId() ||
      this.isSendingBroadcast() ||
      // Block send while an inline image is still uploading, so the send can't
      // race ahead of (and drop) the image the organizer just added.
      (this.bodyEditor()?.isUploadingImage() ?? false) ||
      this.isLoadingBroadcastAudience() ||
      !!this.broadcastAudienceError() ||
      this.broadcastRecipientCount() === 0 ||
      this.broadcastExceedsCap() ||
      this.hasBroadcastLengthErrors() ||
      this.broadcastForm().invalid() ||
      !this.broadcastSubjectTrimmed() ||
      !this.broadcastMessageTrimmed(),
  );

  openSendBroadcastConfirm(): void {
    if (this.isSendBroadcastDisabled()) return;

    this.sendFeedback.set(null);

    const eventId = this.eventId();
    const recipientCount = this.broadcastRecipientCount();
    const recipientLabel = recipientCount === 1 ? 'recipient' : 'recipients';
    const title = this.eventTitle();
    const description = title
      ? `Send this email to ${recipientCount} ${recipientLabel} for "${title}"?`
      : `Send this email to ${recipientCount} ${recipientLabel}?`;

    this.dialogService.create({
      zTitle: 'Send Broadcast Email',
      zDescription: description,
      zOkText: 'Send Email',
      zCancelText: 'Cancel',
      zOnOk: () => {
        void this.sendBroadcast(eventId);
      },
    });
  }

  private async sendBroadcast(eventId: string): Promise<void> {
    if (this.isSendingBroadcast()) return;

    const subject = this.broadcastSubjectTrimmed();
    const message = this.broadcastMessageTrimmed();
    const bodyJson = this.broadcastFormModel().bodyJson;
    if (!subject || !message) return;

    this.isSendingBroadcast.set(true);
    this.sendFeedback.set(null);
    try {
      // Backend re-derives the canonical plaintext from bodyJson; the trimmed
      // message is sent as a best-effort fallback for the text part.
      const args: FunctionArgs<typeof api.events.broadcasts.send> = {
        eventId: eventId as Id<'events'>,
        subject,
        message,
        bodyJson,
        includeExternalTicketHolders: this.includeExternalTicketHolders(),
      };
      const result = await this.convex.mutation(
        api.events.broadcasts.send,
        args,
      );
      if (result.success) {
        const label = result.recipientCount === 1 ? 'recipient' : 'recipients';
        const successMessage = `Broadcast queued for ${result.recipientCount} ${label}`;
        toast.success(successMessage);
        this.sendFeedback.set({kind: 'success', message: successMessage});
        this.resetComposeState();
        this.dataChanged.emit();
      } else {
        const errorMessages: Record<string, string> = {
          no_recipients: 'No recipients found for this event.',
          event_not_found: 'Event not found.',
          validation_error: result.message ?? 'Validation error.',
          too_many_recipients: 'Too many recipients. Maximum is 500.',
          already_sent: 'This broadcast was already sent.',
        };
        const errorMessage =
          errorMessages[result.error] ??
          result.message ??
          'Failed to send broadcast.';
        toast.error(errorMessage);
        this.sendFeedback.set({kind: 'error', message: errorMessage});
      }
    } catch (error) {
      logger.error('Failed to send broadcast email', error);
      const messageText =
        error instanceof Error
          ? error.message
          : 'Failed to send broadcast email';
      toast.error(messageText);
      this.sendFeedback.set({kind: 'error', message: messageText});
    } finally {
      this.isSendingBroadcast.set(false);
    }
  }

  /** Clears the editor document and compose fields after a successful send. */
  private resetComposeState(): void {
    // reset() also invalidates any in-flight image upload so a late insert
    // cannot land in the cleared draft.
    this.bodyEditor()?.reset();
    this.broadcastFormModel.set({subject: '', message: '', bodyJson: ''});
  }
}
