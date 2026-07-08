import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
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

describe('TicketReminderTabComponent', () => {
  let fixture: ComponentFixture<TicketReminderTabComponent>;
  let component: TicketReminderTabComponent;
  let convexMock: MockConvexClient;

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

    await TestBed.configureTestingModule({
      imports: [TicketReminderTabComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: convexMock},
        {provide: BraDialogService, useValue: {create: vi.fn()}},
        {
          provide: AdminEventsService,
          useValue: {sendTicketPurchaseReminder: vi.fn()},
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TicketReminderTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.detectChanges();
    await fixture.whenStable();
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
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.reminderForm().invalid()).toBe(true);
  });
});
