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
      (queryFn: unknown, _args: unknown, onData: (v: unknown) => void) => {
        // Emit asynchronously to mirror the real Convex client: injectQueries
        // registers the active subscription only after onUpdate returns, and its
        // settle guard drops any emission that arrives before that. A synchronous
        // onData here would be silently discarded.
        if (
          functionReferenceMatches(queryFn, api.events.broadcasts.getAudience)
        ) {
          queueMicrotask(() =>
            onData({
              recipientCount: 2,
              exceedsCap: false,
              importedReachableCount: 0,
              importedUnreachableCount: 0,
            }),
          );
        } else if (
          functionReferenceMatches(queryFn, api.events.broadcasts.listHistory)
        ) {
          queueMicrotask(() => onData([]));
        }
        return () => undefined;
      },
    );
    convexMock.onUpdate = onUpdate;
    convexMock.client.onUpdate = onUpdate;
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

  it('explains that late ticket buyers automatically receive the broadcast', async () => {
    expect(await harness.getCatchupNoteText()).toBe(
      'people who get tickets after you send will automatically receive it too.',
    );
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

  it('skips both queries when eventId is empty', async () => {
    const skippedFixture = TestBed.createComponent(BroadcastEmailTabComponent);
    const skippedComponent = skippedFixture.componentInstance;
    skippedFixture.componentRef.setInput('eventId', '');
    skippedFixture.componentRef.setInput('communityId', 'community-1');
    skippedFixture.detectChanges();
    await skippedFixture.whenStable();

    expect(skippedComponent.queries.statuses().audience).toBe('skipped');
    expect(skippedComponent.queries.statuses().history).toBe('skipped');
    expect(skippedComponent.broadcastAudience()).toBeNull();
    expect(skippedComponent.broadcastHistory()).toEqual([]);
  });

  it('shows the include-external toggle, defaulting ON, even at zero imported', async () => {
    expect(await harness.isIncludeExternalToggleVisible()).toBe(true);
    expect(await harness.isIncludeExternalToggled()).toBe(true);
    const countText = await harness.getIncludeExternalCountText();
    // Toggle defaults ON, so the count reads "including" (present participle).
    expect(countText).toContain('including 0 external ticket holders');
  });

  it('reads as excluded when the toggle is off', async () => {
    await harness.clickIncludeExternalToggle();
    expect(await harness.isIncludeExternalToggled()).toBe(false);
    const countText = await harness.getIncludeExternalCountText();
    expect(countText).toContain('external ticket holders excluded');
    expect(countText).not.toContain('including');
  });

  it('renders reachable and unreachable imported counts', async () => {
    // Route by function reference and emit on a microtask — same contract as
    // the beforeEach mock (injectQueries drops synchronous emissions).
    const onUpdate = vi.fn(
      (queryFn: unknown, _args: unknown, cb: (v: unknown) => void) => {
        if (
          functionReferenceMatches(queryFn, api.events.broadcasts.getAudience)
        ) {
          queueMicrotask(() =>
            cb({
              recipientCount: 5,
              exceedsCap: false,
              importedReachableCount: 3,
              importedUnreachableCount: 2,
            }),
          );
        } else if (
          functionReferenceMatches(queryFn, api.events.broadcasts.listHistory)
        ) {
          queueMicrotask(() => cb([]));
        }
        return () => undefined;
      },
    );
    convexMock.onUpdate = onUpdate;
    convexMock.client.onUpdate = onUpdate;

    fixture = TestBed.createComponent(BroadcastEmailTabComponent);
    fixture.componentRef.setInput('eventId', 'event-1');
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.detectChanges();
    await fixture.whenStable();
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      BroadcastEmailTabComponentHarness,
    );

    const countText = await harness.getIncludeExternalCountText();
    expect(countText).toContain('including 3 external ticket holders');
    expect(countText).toContain("2 without an email can't be reached");
  });

  it('sends with includeExternalTicketHolders false when toggled off', async () => {
    await harness.clickIncludeExternalToggle();
    await fixture.whenStable();
    expect(await harness.isIncludeExternalToggled()).toBe(false);

    component.broadcastFormModel.set({
      subject: 'Door update',
      message: 'Bring your ID.',
      bodyJson: '',
    });
    fixture.detectChanges();
    await fixture.whenStable();

    component.openSendBroadcastConfirm();
    const config = dialogServiceMock.create.mock.calls[0][0] as {
      zOnOk: () => void;
    };
    config.zOnOk();
    await fixture.whenStable();

    expect(convexMock.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({includeExternalTicketHolders: false}),
    );
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
