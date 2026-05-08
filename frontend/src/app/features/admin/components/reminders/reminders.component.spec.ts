import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {vi} from 'vitest';
import {AdminRemindersComponent} from './reminders.component';
import {AdminRemindersService} from '@/features/admin/services/admin-reminders.service';
import {CONVEX} from 'convex-angular';
import {AdminRemindersHarness} from './reminders.harness';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
} from '@shared/constants';

describe('AdminRemindersComponent', () => {
  let fixture: ComponentFixture<AdminRemindersComponent>;
  let harness: AdminRemindersHarness;
  let serviceMock: {
    sendVettingReminder: ReturnType<typeof vi.fn>;
  };
  let audienceData: {segment: 'no_application'; recipientCount: number};
  let audienceError: Error | null;
  let convexMock: MockConvexClient;

  beforeEach(async () => {
    audienceData = {
      segment: 'no_application',
      recipientCount: 5,
    };
    audienceError = null;

    serviceMock = {
      sendVettingReminder: vi.fn().mockResolvedValue({
        segment: 'no_application' as const,
        recipientCount: 5,
      }),
    };

    const onUpdate = vi.fn(
      (
        _query: unknown,
        _args: unknown,
        onData: (value: {
          segment: 'no_application';
          recipientCount: number;
        }) => void,
        onError: (error: Error) => void,
      ) => {
        if (audienceError) {
          onError(audienceError);
        } else {
          onData(audienceData);
        }
        return () => void 0;
      },
    );

    convexMock = createMockConvexClient();
    convexMock.onUpdate = onUpdate;
    convexMock.client.onUpdate = onUpdate;

    await TestBed.configureTestingModule({
      imports: [AdminRemindersComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: AdminRemindersService, useValue: serviceMock},
        {provide: CONVEX, useValue: convexMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminRemindersComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminRemindersHarness,
    );
  });

  it('should load audience on init', () => {
    expect(convexMock.client.onUpdate).toHaveBeenCalled();
  });

  it('should display recipient count', async () => {
    const text = await harness.getRecipientCountText();
    expect(text).toContain('5');
    expect(text).toContain('vetting');
  });

  it('should disable send when form is empty', async () => {
    expect(await harness.isSendDisabled()).toBe(true);
  });

  it('should enable send when subject and message are filled', async () => {
    await harness.setSubject('Test Subject');
    await harness.setMessage('Test Message');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await harness.isSendDisabled()).toBe(false);
  });

  it('should call service on send', async () => {
    await harness.setSubject('Reminder Subject');
    await harness.setMessage('Reminder Body');
    fixture.detectChanges();
    await fixture.whenStable();

    await harness.clickSend();
    await fixture.whenStable();

    expect(serviceMock.sendVettingReminder).toHaveBeenCalledWith(
      'Reminder Subject',
      'Reminder Body',
    );
  });

  it('should show audience error when service fails', async () => {
    audienceError = new Error('Network error');

    // Recreate fixture to trigger fresh resource load
    fixture = TestBed.createComponent(AdminRemindersComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const freshHarness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      AdminRemindersHarness,
    );

    const error = await freshHarness.getAudienceErrorText();
    expect(error).toContain('Network error');
  });

  it('should make form invalid when subject exceeds max length', async () => {
    const overLength = 'a'.repeat(MAX_TICKET_REMINDER_SUBJECT_LENGTH + 1);
    fixture.componentInstance.formModel.set({
      subject: overLength,
      message: 'valid message',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.reminderForm().invalid()).toBe(true);
  });

  it('should make form invalid when message exceeds max length', async () => {
    const overLength = 'a'.repeat(MAX_TICKET_REMINDER_MESSAGE_LENGTH + 1);
    fixture.componentInstance.formModel.set({
      subject: 'valid subject',
      message: overLength,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.reminderForm().invalid()).toBe(true);
  });
});
