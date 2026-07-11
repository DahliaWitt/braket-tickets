import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {CONVEX} from 'convex-angular';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
} from '@shared/constants';
import {TicketReminderTabComponent} from './ticket-reminder-tab.component';
import {TicketReminderTabHarness} from './ticket-reminder-tab.component.harness';

const BODY_JSON = JSON.stringify({
  type: 'doc',
  content: [
    {type: 'paragraph', content: [{type: 'text', text: 'Grab your ticket.'}]},
  ],
});

describe('TicketReminderTabComponent', () => {
  let fixture: ComponentFixture<TicketReminderTabComponent>;
  let component: TicketReminderTabComponent;
  let convexMock: MockConvexClient;
  let harness: TicketReminderTabHarness;
  let sendReminderMock: ReturnType<typeof vi.fn>;
  let dialogServiceMock: {create: ReturnType<typeof vi.fn>};

  beforeEach(async () => {
    convexMock = createMockConvexClient();
    const onUpdate = vi.fn(
      (_query: unknown, _args: unknown, onData: (v: unknown) => void) => {
        onData({recipientCount: 3, missingOrganizer: false});
        return () => undefined;
      },
    );
    convexMock.onUpdate = onUpdate;
    convexMock.client.onUpdate = onUpdate;
    convexMock.query = vi
      .fn()
      .mockResolvedValue({recipientCount: 3, missingOrganizer: false});
    sendReminderMock = vi.fn().mockResolvedValue({recipientCount: 3});
    dialogServiceMock = {create: vi.fn()};

    await TestBed.configureTestingModule({
      imports: [TicketReminderTabComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: convexMock},
        {provide: BraDialogService, useValue: dialogServiceMock},
        {
          provide: AdminEventsService,
          useValue: {sendTicketPurchaseReminder: sendReminderMock},
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TicketReminderTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.detectChanges();
    await fixture.whenStable();
    // afterNextRender creates the TipTap editor and emits its initial empty
    // document; flush again so that emission lands before the test body runs.
    fixture.detectChanges();
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      TicketReminderTabHarness,
    );
  });

  it('renders the rich-text editor for the message body', async () => {
    expect(await harness.hasMessageEditor()).toBe(true);
  });

  it('supplies an image uploader so the editor image button is enabled', async () => {
    const editor = await harness.getMessageEditorHarness();
    expect(await editor.isImageButtonEnabled()).toBe(true);
  });

  it('subscribes to the reminder audience and reflects the recipient count', () => {
    expect(component.reminderRecipientCount()).toBe(3);
    expect(component.reminderMissingCommunity()).toBe(false);
    expect(component.reminderAudience()).not.toBeNull();
    expect(convexMock.onUpdate).toHaveBeenCalled();
  });

  it('skips the audience query when eventId is empty', async () => {
    fixture.componentRef.setInput('eventId', '');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.reminderRecipientCount()).toBe(0);
    expect(component.isSendReminderDisabled()).toBe(true);
  });

  it('should make form invalid when subject exceeds max length', async () => {
    const overLength = 'a'.repeat(MAX_TICKET_REMINDER_SUBJECT_LENGTH + 1);
    component.reminderFormModel.set({
      subject: overLength,
      message: 'valid message',
      bodyJson: BODY_JSON,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.reminderForm().invalid()).toBe(true);
  });

  it('should make form invalid when message exceeds max length', async () => {
    const overLength = 'a'.repeat(MAX_TICKET_REMINDER_MESSAGE_LENGTH + 1);
    component.reminderFormModel.set({
      subject: 'valid subject',
      message: overLength,
      bodyJson: BODY_JSON,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.reminderForm().invalid()).toBe(true);
  });

  it('sends the serialized body JSON alongside the plaintext fallback', async () => {
    component.reminderFormModel.update((model) => ({
      ...model,
      subject: 'Last call',
    }));
    // Simulate the editor emitting its document + derived plaintext.
    component.onBodyTextChange('Grab your ticket.');
    component.onBodyJsonChange(BODY_JSON);
    fixture.detectChanges();
    await fixture.whenStable();

    component.openSendTicketReminderConfirm();

    expect(dialogServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Send Ticket Reminder',
        zOkText: 'Send Reminder',
      }),
    );

    const config = dialogServiceMock.create.mock.calls[0][0] as {
      zOnOk: () => Promise<void>;
    };
    await config.zOnOk();
    await fixture.whenStable();

    expect(sendReminderMock).toHaveBeenCalledWith(
      'event-1',
      'Last call',
      'Grab your ticket.',
      BODY_JSON,
    );
  });
});
