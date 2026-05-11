import {ChangeDetectionStrategy, Component, inject} from '@angular/core';
import type {Meta, StoryObj} from '@storybook/angular';

import {BraToastComponent} from './toast.component';
import {BraToastService} from './toast.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';

@Component({
  selector: 'bt-story-toast-app-flows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, BraToastComponent],
  template: `
    <bra-toaster />
    <section class="space-y-4 rounded-2xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p
          class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
        >
          App-proven patterns
        </p>
        <h3 class="font-display text-xl text-foreground">
          Operational feedback states
        </h3>
        <p class="max-w-2xl text-sm text-muted-foreground">
          These messages mirror the short-lived feedback users and admins
          actually see across account settings, guest-ticket delivery, and
          resale actions.
        </p>
      </div>

      <div class="flex flex-wrap gap-3">
        <button z-button zType="default" (click)="showSettingsSaved()">
          Settings saved
        </button>
        <button z-button zType="secondary" (click)="showTicketSent()">
          Guest ticket sent
        </button>
        <button z-button zType="outline" (click)="showResaleSubscribed()">
          Resale subscribed
        </button>
        <button z-button zType="destructive" (click)="showBroadcastFailed()">
          Broadcast failed
        </button>
      </div>
    </section>
  `,
})
class ToastAppFlowsComponent {
  private readonly toastService = inject(BraToastService);

  showSettingsSaved(): void {
    this.toastService.success('Settings saved');
  }

  showTicketSent(): void {
    this.toastService.success('Ticket sent successfully');
  }

  showResaleSubscribed(): void {
    this.toastService.show({
      message: "You'll be notified when a resale ticket becomes available",
      type: 'info',
    });
  }

  showBroadcastFailed(): void {
    this.toastService.error('Failed to send broadcast.');
  }
}

@Component({
  selector: 'bt-story-toast-description',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, BraToastComponent],
  template: `
    <bra-toaster />
    <section class="space-y-4 rounded-2xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p
          class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
        >
          App-proven detail
        </p>
        <h3 class="font-display text-xl text-foreground">
          Purchase confirmation context
        </h3>
        <p class="max-w-2xl text-sm text-muted-foreground">
          Mirrors the richer confirmation messaging used when the app needs to
          preserve event-level context alongside the toast title.
        </p>
      </div>

      <button z-button zType="secondary" (click)="show()">
        Show purchase confirmation
      </button>
    </section>
  `,
})
class ToastDescriptionComponent {
  private readonly toastService = inject(BraToastService);

  show(): void {
    this.toastService.success('You are on the list!', {
      description: 'Subterranean Vol. 12 · General Admission · Sat Apr 5',
    });
  }
}

@Component({
  selector: 'bt-story-toast-reference-action',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, BraToastComponent],
  template: `
    <bra-toaster />
    <section class="space-y-4 rounded-2xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p
          class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
        >
          Library reference
        </p>
        <h3 class="font-display text-xl text-foreground">Undo action toast</h3>
        <p class="max-w-2xl text-sm text-muted-foreground">
          The toast system supports inline actions, but this exact undo pattern
          is reference behavior rather than a current app-proven flow.
        </p>
      </div>

      <button z-button zType="outline" (click)="show()">
        Show undo action
      </button>
    </section>
  `,
})
class ToastReferenceActionComponent {
  private readonly toastService = inject(BraToastService);

  show(): void {
    this.toastService.show({
      message: 'Reservation cancelled.',
      description: 'Your spot has been released.',
      action: {
        label: 'Undo',
        onClick: () => {
          this.toastService.success('Reservation restored!');
        },
      },
    });
  }
}

@Component({
  selector: 'bt-story-toast-top-center',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, BraToastComponent],
  template: `
    <bra-toaster position="top-center" />
    <section class="space-y-4 rounded-2xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p
          class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
        >
          Library reference
        </p>
        <h3 class="font-display text-xl text-foreground">
          Alternate placement
        </h3>
        <p class="max-w-2xl text-sm text-muted-foreground">
          Top-center placement is supported for focused workflows, though the
          app normally uses the default viewport position.
        </p>
      </div>

      <button z-button zType="outline" (click)="show()">
        Show top-center toast
      </button>
    </section>
  `,
})
class ToastTopCenterComponent {
  private readonly toastService = inject(BraToastService);

  show(): void {
    this.toastService.show({message: 'Appearing at top center.'});
  }
}

const meta: Meta = {
  title: 'Braket/Composites/Toast',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Toast stories now distinguish app-proven feedback messages from library-only capabilities such as inline undo actions or alternate placement.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: `<bt-story-toast-app-flows />`,
    moduleMetadata: {imports: [ToastAppFlowsComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven short feedback messages for settings, guest tickets, resale, and broadcast failures.',
      },
    },
  },
};

export const WithDescription: Story = {
  render: () => ({
    template: `<bt-story-toast-description />`,
    moduleMetadata: {imports: [ToastDescriptionComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven richer toast with event context for purchase confirmation.',
      },
    },
  },
};

export const ReferenceAction: Story = {
  render: () => ({
    template: `<bt-story-toast-reference-action />`,
    moduleMetadata: {imports: [ToastReferenceActionComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for inline toast actions; the app does not currently use this undo pattern.',
      },
    },
  },
};

export const ReferenceTopCenter: Story = {
  render: () => ({
    template: `<bt-story-toast-top-center />`,
    moduleMetadata: {imports: [ToastTopCenterComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for alternate toast placement beyond the app default.',
      },
    },
  },
};
