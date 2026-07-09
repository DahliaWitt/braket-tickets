import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  resource,
  signal,
} from '@angular/core';
import {DatePipe} from '@angular/common';
import {form, FormField, maxLength, required} from '@angular/forms/signals';
import {toast} from 'ngx-sonner';
import {api} from '@convex/_generated/api';
import type {Id} from '@convex/_generated/dataModel';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
} from '@shared/constants';
import {injectConvex} from 'convex-angular';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from '@ui/components/primitives/card/card.component';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardSwitchComponent} from '@ui/components/primitives/switch/switch.component';
import {logger} from '@/utils/logger';
import {safeResourceValue} from '@/utils/resource';

@Component({
  selector: 'app-broadcast-email-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {class: 'block'},
  imports: [
    DatePipe,
    FormField,
    ZardButtonComponent,
    ZardCardComponent,
    ZardIconComponent,
    ZardSwitchComponent,
  ],
  templateUrl: './broadcast-email-tab.component.html',
})
export class BroadcastEmailTabComponent {
  private convex = injectConvex();
  private dialogService = inject(BraDialogService);

  readonly eventId = input.required<string>();
  readonly communityId = input.required<string>();
  readonly reloadToken = input<number>(0);
  readonly eventTitle = input<string>('');
  readonly dataChanged = output();

  readonly maxTicketReminderSubjectLength = MAX_TICKET_REMINDER_SUBJECT_LENGTH;
  readonly maxTicketReminderMessageLength = MAX_TICKET_REMINDER_MESSAGE_LENGTH;

  readonly broadcastFormModel = signal({subject: '', message: ''});

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

  private readonly broadcastAudienceReloadToken = signal(0);

  // include external (imported) ticket holders in the send — defaults ON,
  // mirroring the backend default. Always visible in the compose flow so
  // organizers discover the behavior before they need it.
  readonly includeExternalTicketHolders = signal(true);

  readonly broadcastAudienceResource = resource({
    params: () => ({
      eventId: this.eventId() || null,
      includeExternal: this.includeExternalTicketHolders(),
      parentReloadToken: this.reloadToken(),
      localReloadToken: this.broadcastAudienceReloadToken(),
    }),
    loader: ({params}) => {
      if (!params.eventId) return Promise.resolve(null);
      return this.convex.query(api.events.broadcasts.getAudience, {
        eventId: params.eventId as Id<'events'>,
        includeExternalTicketHolders: params.includeExternal,
      });
    },
  });

  readonly broadcastHistoryResource = resource({
    params: () => ({
      eventId: this.eventId() || null,
      parentReloadToken: this.reloadToken(),
      localReloadToken: this.broadcastAudienceReloadToken(),
    }),
    loader: ({params}) => {
      if (!params.eventId) return Promise.resolve(null);
      return this.convex.query(api.events.broadcasts.listHistory, {
        eventId: params.eventId as Id<'events'>,
      });
    },
  });

  readonly broadcastAudience = computed(
    () => safeResourceValue(this.broadcastAudienceResource) ?? null,
  );
  readonly isLoadingBroadcastAudience =
    this.broadcastAudienceResource.isLoading;
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
    const error = this.broadcastAudienceResource.error();
    if (!error) return null;
    return error instanceof Error && error.message
      ? `couldn't load audience — ${error.message}`
      : "couldn't load audience";
  });

  readonly broadcastHistory = computed(
    () => safeResourceValue(this.broadcastHistoryResource) ?? [],
  );
  readonly isLoadingBroadcastHistory = this.broadcastHistoryResource.isLoading;
  readonly broadcastHistoryError = computed(() => {
    const error = this.broadcastHistoryResource.error();
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
    if (!subject || !message) return;

    this.isSendingBroadcast.set(true);
    this.sendFeedback.set(null);
    try {
      const result = await this.convex.mutation(api.events.broadcasts.send, {
        eventId: eventId as Id<'events'>,
        subject,
        message,
        includeExternalTicketHolders: this.includeExternalTicketHolders(),
      });
      if (result.success) {
        const label = result.recipientCount === 1 ? 'recipient' : 'recipients';
        const successMessage = `Broadcast queued for ${result.recipientCount} ${label}`;
        toast.success(successMessage);
        this.sendFeedback.set({kind: 'success', message: successMessage});
        this.broadcastFormModel.set({subject: '', message: ''});
        this.broadcastAudienceReloadToken.update((count) => count + 1);
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
}
