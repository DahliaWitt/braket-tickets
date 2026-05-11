import {
  ChangeDetectionStrategy,
  Component,
  afterNextRender,
  viewChild,
} from '@angular/core';
import type {Meta, StoryObj} from '@storybook/angular';
import {applicationConfig} from '@storybook/angular';

import {
  type EventManagementPurchase,
  type Guest,
} from '@/features/admin/models/event-management.model';
import {AdminEventsService} from '@/features/admin/services/admin-events.service';
import {AttendeeExportService} from '@/features/admin/services/attendee-export.service';
import {EventManagementGuestsTabComponent} from '@/features/admin/pages/event-management/components/event-management-guests-tab/event-management-guests-tab.component';
import {EventManagementPurchasesPanelComponent} from '@/features/admin/pages/event-management/components/event-management-purchases-panel/event-management-purchases-panel.component';
import {BraAlertDialogService} from '@ui/components/composites/alert-dialog/alert-dialog.service';

class StoryAdminEventsService {
  addGuest(): Promise<void> {
    return Promise.resolve();
  }

  removeGuest(): Promise<void> {
    return Promise.resolve();
  }

  sendGuestTicket(): Promise<void> {
    return Promise.resolve();
  }

  getGuestTicketPdf(): Promise<string> {
    return Promise.resolve('data:application/pdf;base64,');
  }

  getTicketPdf(): Promise<string> {
    return Promise.resolve('data:application/pdf;base64,');
  }
}

class StoryAttendeeExportService {
  export(): Promise<void> {
    return Promise.resolve();
  }
}

class StoryAlertDialogService {
  confirm(): void {}
}

function buildGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    _id: 'guest_story_1' as Guest['_id'],
    _creationTime: Date.now(),
    eventId: 'evt_story_management' as Guest['eventId'],
    name: 'Charlie Kelly',
    email: 'charlie@example.com',
    type: 'artist guest',
    notes: 'Guest list plus one at doors.',
    emailedAt: Date.now() - 1000 * 60 * 30,
    ...overrides,
  };
}

function buildPurchase(
  overrides: Partial<EventManagementPurchase> = {},
): EventManagementPurchase {
  return {
    id: 'purchase_story_1',
    userId: 'user_story_buyer',
    userName: 'Jordan Lee',
    userEmail: 'jordan@example.com',
    tier: 'supporter',
    quantity: 2,
    amount: 7800,
    status: 'completed',
    createdAt: Date.now() - 1000 * 60 * 60 * 12,
    refundedAmountCents: 0,
    tickets: [
      {
        id: 'ticket_story_1',
        status: 'valid',
        tier: 'supporter',
      },
      {
        id: 'ticket_story_2',
        status: 'used',
        tier: 'supporter',
      },
    ] as EventManagementPurchase['tickets'],
    ...overrides,
  } as EventManagementPurchase;
}

const STORY_GUESTS: Guest[] = [
  buildGuest(),
  buildGuest({
    _id: 'guest_story_2' as Guest['_id'],
    name: 'Avery Chen',
    email: undefined,
    type: 'staff',
    notes: 'Will check in with stage manager.',
    emailedAt: undefined,
  }),
];

const STORY_PURCHASES: EventManagementPurchase[] = [
  buildPurchase(),
  buildPurchase({
    id: 'purchase_story_2' as EventManagementPurchase['id'],
    userId: 'user_story_buyer_2' as EventManagementPurchase['userId'],
    userName: 'Riley Park',
    userEmail: 'riley@example.com',
    tier: 'regular',
    quantity: 1,
    amount: 3500,
    status: 'refunded',
    refundedAmountCents: 3500,
    tickets: [
      {
        id: 'ticket_story_3' as EventManagementPurchase['tickets'][number]['id'],
        status: 'refunded',
        tier: 'regular',
      },
    ] as unknown as EventManagementPurchase['tickets'],
  }),
];

@Component({
  selector: 'bt-story-dialog-guest-workflow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EventManagementGuestsTabComponent],
  template: `
    <section class="min-h-screen bg-muted/30 p-6">
      <div class="mx-auto max-w-5xl space-y-4">
        <div class="space-y-1">
          <p
            class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
          >
            Event management
          </p>
          <h2 class="font-display text-2xl text-foreground">
            Guest list workflow
          </h2>
          <p class="max-w-2xl text-sm text-muted-foreground">
            Mirrors the real admin guest-list context. The story auto-opens the
            same “Add Guest” dialog the product launches from the guest tab.
          </p>
        </div>

        <app-event-management-guests-tab
          eventId="evt_story_management"
          [guests]="guests"
          [isLoading]="false"
        />
      </div>
    </section>
  `,
})
class DialogGuestWorkflowStoryComponent {
  protected readonly guests = STORY_GUESTS;

  private readonly guestsTab = viewChild.required(
    EventManagementGuestsTabComponent,
  );

  constructor() {
    afterNextRender(() => {
      this.guestsTab().openAddGuestDialog();
    });
  }
}

@Component({
  selector: 'bt-story-dialog-export-workflow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EventManagementPurchasesPanelComponent],
  template: `
    <section class="min-h-screen bg-muted/30 p-6">
      <div class="mx-auto max-w-6xl space-y-4">
        <div class="space-y-1">
          <p
            class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
          >
            Event management
          </p>
          <h2 class="font-display text-2xl text-foreground">
            Attendee export workflow
          </h2>
          <p class="max-w-2xl text-sm text-muted-foreground">
            Uses the real buyers panel and launches the actual export dialog
            with sample purchases and guests, including a refunded order so the
            dialog shows its real operator options.
          </p>
        </div>

        <app-event-management-purchases-panel
          eventTitle="Void Sessions Vol. 12"
          eventDate="2026-06-20T22:00:00.000Z"
          [purchases]="purchases"
          [guests]="guests"
        />
      </div>
    </section>
  `,
})
class DialogExportWorkflowStoryComponent {
  protected readonly purchases = STORY_PURCHASES;
  protected readonly guests = STORY_GUESTS;

  private readonly purchasesPanel = viewChild.required(
    EventManagementPurchasesPanelComponent,
  );

  constructor() {
    afterNextRender(() => {
      this.purchasesPanel().openExportDialog();
    });
  }
}

const meta: Meta = {
  title: 'Braket/Composites/Dialog',
  tags: ['autodocs'],
  decorators: [
    applicationConfig({
      providers: [
        {provide: AdminEventsService, useClass: StoryAdminEventsService},
        {provide: AttendeeExportService, useClass: StoryAttendeeExportService},
        {provide: BraAlertDialogService, useClass: StoryAlertDialogService},
      ],
    }),
  ],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Dialog stories now document the real admin workflows that use this composite. Destructive confirm flows are documented separately in AlertDialog stories.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const AddGuestWorkflow: Story = {
  render: () => ({
    template: `<bt-story-dialog-guest-workflow />`,
    moduleMetadata: {imports: [DialogGuestWorkflowStoryComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven dialog workflow for adding a guest from event management.',
      },
    },
  },
};

export const ExportAttendeeList: Story = {
  render: () => ({
    template: `<bt-story-dialog-export-workflow />`,
    moduleMetadata: {imports: [DialogExportWorkflowStoryComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven dialog workflow for exporting attendees from the buyers panel.',
      },
    },
  },
};
