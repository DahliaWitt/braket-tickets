import '../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {provideZonelessChangeDetection} from '@angular/core';
import {vi, describe, it, expect, beforeEach} from 'vitest';
import {CONVEX} from 'convex-angular';
import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {
  createMockConvexClient,
  type MockConvexClient,
} from '@/testing/mock-types';
import {functionReferenceMatches} from '@/testing/convex-reference-matchers';
import {api} from '@convex/_generated/api';
import {
  MAX_TICKET_REMINDER_MESSAGE_LENGTH,
  MAX_TICKET_REMINDER_SUBJECT_LENGTH,
} from '@shared/constants';
import {BroadcastEmailTabComponent} from './broadcast-email-tab.component';
import {BroadcastEmailTabComponentHarness} from './broadcast-email-tab.component.harness';

describe('BroadcastEmailTabComponent', () => {
  let fixture: ComponentFixture<BroadcastEmailTabComponent>;
  let component: BroadcastEmailTabComponent;
  let harness: BroadcastEmailTabComponentHarness;
  let convexMock: MockConvexClient;
  let dialogServiceMock: {create: ReturnType<typeof vi.fn>};

  beforeEach(async () => {
    convexMock = createMockConvexClient();
    const onUpdate = vi.fn(
      (_query: unknown, _args: unknown, onData: (v: unknown) => void) => {
        onData({recipientCount: 2, exceedsCap: false});
        return () => undefined;
      },
    );
    convexMock.onUpdate = onUpdate;
    convexMock.client.onUpdate = onUpdate;
    convexMock.query = vi.fn((queryFn: unknown) => {
      if (
        functionReferenceMatches(queryFn, api.events.broadcasts.getAudience)
      ) {
        return Promise.resolve({recipientCount: 2, exceedsCap: false});
      }
      if (
        functionReferenceMatches(queryFn, api.events.broadcasts.listHistory)
      ) {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });
    convexMock.mutation = vi
      .fn()
      .mockResolvedValue({success: true, recipientCount: 2});
    dialogServiceMock = {create: vi.fn()};

    await TestBed.configureTestingModule({
      imports: [BroadcastEmailTabComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: CONVEX, useValue: convexMock},
        {provide: BraDialogService, useValue: dialogServiceMock},
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BroadcastEmailTabComponent);
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
      BroadcastEmailTabComponentHarness,
    );
  });

  const BODY_JSON = JSON.stringify({
    type: 'doc',
    content: [
      {type: 'paragraph', content: [{type: 'text', text: 'Bring your ID.'}]},
    ],
  });

  it('renders the rich-text editor for the message body', async () => {
    expect(await harness.hasMessageEditor()).toBe(true);
  });

  it('supplies an image uploader so the editor image button is enabled', async () => {
    const editor = await harness.getMessageEditorHarness();
    expect(await editor.isImageButtonEnabled()).toBe(true);
  });

  it('uses the email-card spacing contract', async () => {
    expect(await harness.usesEmailCardSpacingContract()).toBe(true);
  });

  it('should make form invalid when subject exceeds max length', async () => {
    const overLength = 'a'.repeat(MAX_TICKET_REMINDER_SUBJECT_LENGTH + 1);
    component.broadcastFormModel.set({
      subject: overLength,
      message: 'valid message',
      bodyJson: BODY_JSON,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.broadcastForm().invalid()).toBe(true);
  });

  it('should make form invalid when message exceeds max length', async () => {
    const overLength = 'a'.repeat(MAX_TICKET_REMINDER_MESSAGE_LENGTH + 1);
    component.broadcastFormModel.set({
      subject: 'valid subject',
      message: overLength,
      bodyJson: BODY_JSON,
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.broadcastForm().invalid()).toBe(true);
  });

  it('sends the serialized body JSON alongside the plaintext fallback', async () => {
    component.broadcastFormModel.update((model) => ({
      ...model,
      subject: 'Door update',
    }));
    // Simulate the editor emitting its document + derived plaintext.
    component.onBodyTextChange('Bring your ID.');
    component.onBodyJsonChange(BODY_JSON);
    fixture.detectChanges();
    await fixture.whenStable();

    component.openSendBroadcastConfirm();

    expect(dialogServiceMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        zTitle: 'Send Broadcast Email',
        zOkText: 'Send Email',
      }),
    );

    const config = dialogServiceMock.create.mock.calls[0][0] as {
      zOnOk: () => void;
    };
    config.zOnOk();
    await fixture.whenStable();

    expect(convexMock.mutation).toHaveBeenCalledOnce();
    expect(convexMock.mutation).toHaveBeenCalledWith(
      api.events.broadcasts.send,
      expect.objectContaining({
        subject: 'Door update',
        message: 'Bring your ID.',
        bodyJson: BODY_JSON,
      }),
    );
    expect(component.sendFeedback()).toEqual({
      kind: 'success',
      message: 'Broadcast queued for 2 recipients',
    });
  });
});
