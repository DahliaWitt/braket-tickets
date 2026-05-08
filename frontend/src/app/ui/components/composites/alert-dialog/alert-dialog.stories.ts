import { ChangeDetectionStrategy, Component, afterNextRender, inject } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';

import { ZardButtonComponent } from '@ui/components/primitives/button/button.component';
import { BraAlertDialogService } from './alert-dialog.service';

@Component({
  selector: 'bt-story-alert-dialog-unsaved-changes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent],
  template: `
    <section class="min-h-screen bg-muted/30 p-6">
      <div class="mx-auto max-w-3xl space-y-4 rounded-2xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            App-proven confirm flow
          </p>
          <h3 class="font-display text-2xl text-foreground">Unsaved changes guard</h3>
          <p class="text-sm text-muted-foreground">
            Mirrors the event-editor navigation guard. The alert dialog auto-opens so the actual
            destructive confirm state is visible in Storybook.
          </p>
        </div>

        <button z-button zType="outline" (click)="open()">Try leaving editor</button>
      </div>
    </section>
  `,
})
class AlertDialogUnsavedChangesComponent {
  private readonly alertDialogService = inject(BraAlertDialogService);

  constructor() {
    afterNextRender(() => {
      this.open();
    });
  }

  open(): void {
    this.alertDialogService.confirm({
      zTitle: 'Unsaved Changes',
      zDescription: 'You have unsaved changes that will be lost. Are you sure you want to leave?',
      zOkText: 'Discard Changes',
      zCancelText: 'Keep Editing',
      zOkDestructive: true,
      zMaskClosable: false,
    });
  }
}

@Component({
  selector: 'bt-story-alert-dialog-refund-payment',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent],
  template: `
    <section class="min-h-screen bg-muted/30 p-6">
      <div class="mx-auto max-w-3xl space-y-4 rounded-2xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            App-proven confirm flow
          </p>
          <h3 class="font-display text-2xl text-foreground">Buyer refund confirmation</h3>
          <p class="text-sm text-muted-foreground">
            Mirrors the refund action from event management when an admin refunds only the unused
            tickets in a purchase.
          </p>
        </div>

        <button z-button zType="destructive" (click)="open()">Refund payment</button>
      </div>
    </section>
  `,
})
class AlertDialogRefundPaymentComponent {
  private readonly alertDialogService = inject(BraAlertDialogService);

  constructor() {
    afterNextRender(() => {
      this.open();
    });
  }

  open(): void {
    this.alertDialogService.confirm({
      zTitle: 'Refund Payment',
      zDescription:
        'Refund $39.00 to Jordan Lee for 2 tickets? Only unused tickets will be refunded. This action cannot be undone.',
      zOkText: 'Refund Payment',
      zCancelText: 'Keep Payment',
      zOkDestructive: true,
      zMaskClosable: false,
    });
  }
}

@Component({
  selector: 'bt-story-alert-dialog-contact-organizer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent],
  template: `
    <section class="min-h-screen bg-muted/30 p-6">
      <div class="mx-auto max-w-3xl space-y-4 rounded-2xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            App-proven info flow
          </p>
          <h3 class="font-display text-2xl text-foreground">Organizer contact details</h3>
          <p class="text-sm text-muted-foreground">
            Mirrors the event-details fallback when the organizer has contact info but no public
            email address.
          </p>
        </div>

        <button z-button zType="outline" (click)="open()">Contact organizer</button>
      </div>
    </section>
  `,
})
class AlertDialogContactOrganizerComponent {
  private readonly alertDialogService = inject(BraAlertDialogService);

  constructor() {
    afterNextRender(() => {
      this.open();
    });
  }

  open(): void {
    this.alertDialogService.info({
      zTitle: 'Signal House',
      zContent: 'Signal-only contact hours: Tuesdays and Thursdays.',
      zOkText: 'Done',
    });
  }
}

@Component({
  selector: 'bt-story-alert-dialog-warning-reference',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent],
  template: `
    <section class="min-h-screen bg-muted/30 p-6">
      <div class="mx-auto max-w-3xl space-y-4 rounded-2xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Library reference
          </p>
          <h3 class="font-display text-2xl text-foreground">Inventory warning</h3>
          <p class="text-sm text-muted-foreground">
            Warning dialogs are supported by the service, but this exact warning treatment is not a
            current app-proven workflow.
          </p>
        </div>

        <button z-button zType="outline" (click)="open()">Show warning</button>
      </div>
    </section>
  `,
})
class AlertDialogWarningReferenceComponent {
  private readonly alertDialogService = inject(BraAlertDialogService);

  constructor() {
    afterNextRender(() => {
      this.open();
    });
  }

  open(): void {
    this.alertDialogService.warning({
      zTitle: 'Event Sold Out',
      zDescription:
        'No tickets are available for this event. Join the waitlist to be notified if spots open up.',
      zOkText: 'OK',
    });
  }
}

const meta: Meta = {
  title: 'Braket/Composites/AlertDialog',
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Alert dialog stories prioritize the confirm and info flows the app actually uses today, with one warning story kept as a clearly labeled library reference.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const UnsavedChangesGuard: Story = {
  render: () => ({
    template: `<bt-story-alert-dialog-unsaved-changes />`,
    moduleMetadata: { imports: [AlertDialogUnsavedChangesComponent] },
  }),
};

export const RefundPayment: Story = {
  render: () => ({
    template: `<bt-story-alert-dialog-refund-payment />`,
    moduleMetadata: { imports: [AlertDialogRefundPaymentComponent] },
  }),
};

export const ContactOrganizerInfo: Story = {
  render: () => ({
    template: `<bt-story-alert-dialog-contact-organizer />`,
    moduleMetadata: { imports: [AlertDialogContactOrganizerComponent] },
  }),
};

export const WarningReference: Story = {
  render: () => ({
    template: `<bt-story-alert-dialog-warning-reference />`,
    moduleMetadata: { imports: [AlertDialogWarningReferenceComponent] },
  }),
};
