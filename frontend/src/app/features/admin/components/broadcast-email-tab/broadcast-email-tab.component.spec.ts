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
        onData({
          recipientCount: 2,
          exceedsCap: false,
          importedReachableCount: 0,
          importedUnreachableCount: 0,
        });
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
    harness = await TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      BroadcastEmailTabComponentHarness,
    );
  });

  it('uses the email-card spacing contract', async () => {
    expect(await harness.usesEmailCardSpacingContract()).toBe(true);
  });

  it('should make form invalid when subject exceeds max length', async () => {
    const overLength = 'a'.repeat(MAX_TICKET_REMINDER_SUBJECT_LENGTH + 1);
    component.broadcastFormModel.set({
      subject: overLength,
      message: 'valid message',
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
    });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.broadcastForm().invalid()).toBe(true);
  });

  it('shows the include-external toggle, defaulting ON, even at zero imported', async () => {
    expect(await harness.isIncludeExternalToggleVisible()).toBe(true);
    expect(await harness.isIncludeExternalToggled()).toBe(true);
    const countText = await harness.getIncludeExternalCountText();
    expect(countText).toContain('includes 0 external ticket holders');
  });

  it('renders reachable and unreachable imported counts', async () => {
    const onData = (_q: unknown, _a: unknown, cb: (v: unknown) => void) => {
      cb({
        recipientCount: 5,
        exceedsCap: false,
        importedReachableCount: 3,
        importedUnreachableCount: 2,
      });
      return () => undefined;
    };
    convexMock.onUpdate = onData as never;
    convexMock.client.onUpdate = onData as never;
    convexMock.query = vi.fn((queryFn: unknown) => {
      if (
        functionReferenceMatches(queryFn, api.events.broadcasts.getAudience)
      ) {
        return Promise.resolve({
          recipientCount: 5,
          exceedsCap: false,
          importedReachableCount: 3,
          importedUnreachableCount: 2,
        });
      }
      if (
        functionReferenceMatches(queryFn, api.events.broadcasts.listHistory)
      ) {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });

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
    expect(countText).toContain('includes 3 external ticket holders');
    expect(countText).toContain("2 without an email can't be reached");
  });

  it('sends with includeExternalTicketHolders false when toggled off', async () => {
    await harness.clickIncludeExternalToggle();
    await fixture.whenStable();
    expect(await harness.isIncludeExternalToggled()).toBe(false);

    component.broadcastFormModel.set({
      subject: 'Door update',
      message: 'Bring your ID.',
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

  it('opens confirmation and shows feedback after a broadcast is confirmed', async () => {
    component.broadcastFormModel.set({
      subject: 'Door update',
      message: 'Bring your ID.',
    });
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
    expect(component.sendFeedback()).toEqual({
      kind: 'success',
      message: 'Broadcast queued for 2 recipients',
    });
  });
});
