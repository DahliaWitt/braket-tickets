import type {Meta, StoryObj} from '@storybook/angular';

import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardSelectComponent} from './select.component';
import {ZardSelectItemComponent} from './select-item.component';

const meta: Meta<ZardSelectComponent> = {
  title: 'Braket/Primitives/Select',
  component: ZardSelectComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Select is app-proven in admin forms, guest workflows, and ticket-access configuration. The stories below prioritize those product-real compositions first, with the simpler size and disabled variants kept as reference coverage for the primitive API.',
      },
    },
  },
  argTypes: {
    zSize: {
      control: 'select',
      options: ['sm', 'default', 'lg'],
    },
    zDisabled: {control: 'boolean'},
    zMultiple: {control: 'boolean'},
    zPlaceholder: {control: 'text'},
    zAriaLabel: {
      control: 'text',
      description: 'Accessible label applied to the select trigger.',
    },
    zAriaLabelledBy: {
      control: 'text',
      description: 'ID reference for an external label element.',
    },
    zLabel: {
      control: 'text',
      description:
        'Fallback selected-value label for compact single-select display.',
    },
    zMaxLabelCount: {
      control: {type: 'number', min: 1, step: 1},
      description:
        'Maximum selected labels shown before multi-select overflow copy is used.',
    },
  },
  render: (args) => ({
    props: args,
    template: `
      <z-select
        [zSize]="zSize"
        [zDisabled]="zDisabled"
        [zPlaceholder]="zPlaceholder"
        [zMultiple]="zMultiple"
        [zAriaLabel]="zAriaLabel"
        [zAriaLabelledBy]="zAriaLabelledBy"
        [zLabel]="zLabel"
        [zMaxLabelCount]="zMaxLabelCount"
      >
        <z-select-item zValue="general">General Admission</z-select-item>
        <z-select-item zValue="vip">VIP Access</z-select-item>
        <z-select-item zValue="backstage">Backstage Pass</z-select-item>
      </z-select>
    `,
    moduleMetadata: {
      imports: [ZardSelectItemComponent],
    },
  }),
};

export default meta;
type Story = StoryObj<ZardSelectComponent>;

export const Default: Story = {
  args: {
    zSize: 'default',
    zPlaceholder: 'Select ticket type...',
  },
  parameters: {
    docs: {
      description: {
        story: 'Reference playground for the base select API and sizing props.',
      },
    },
  },
};

export const Small: Story = {
  args: {
    zSize: 'sm',
    zPlaceholder: 'Select tier...',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Reference small-size trigger for compact toolbars and dense forms.',
      },
    },
  },
};

export const Large: Story = {
  args: {
    zSize: 'lg',
    zPlaceholder: 'Select ticket type...',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Reference large-size trigger for more spacious form treatments.',
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    zDisabled: true,
    zPlaceholder: 'Unavailable',
  },
  parameters: {
    docs: {
      description: {
        story: 'Reference disabled state for read-only or unavailable choices.',
      },
    },
  },
};

export const AllSizes: Story = {
  render: () => ({
    props: {},
    template: `
      <div class="flex flex-col gap-4 w-64">
        <div>
          <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground mb-1 block">Small</span>
          <z-select zSize="sm" zPlaceholder="Select tier...">
            <z-select-item zValue="general">General Admission</z-select-item>
            <z-select-item zValue="vip">VIP Access</z-select-item>
          </z-select>
        </div>
        <div>
          <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground mb-1 block">Default</span>
          <z-select zSize="default" zPlaceholder="Select tier...">
            <z-select-item zValue="general">General Admission</z-select-item>
            <z-select-item zValue="vip">VIP Access</z-select-item>
          </z-select>
        </div>
        <div>
          <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground mb-1 block">Large</span>
          <z-select zSize="lg" zPlaceholder="Select tier...">
            <z-select-item zValue="general">General Admission</z-select-item>
            <z-select-item zValue="vip">VIP Access</z-select-item>
          </z-select>
        </div>
      </div>
    `,
    moduleMetadata: {
      imports: [ZardSelectItemComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Reference overview of the primitive across its supported trigger sizes.',
      },
    },
  },
};

export const Multiple: Story = {
  render: () => ({
    props: {},
    template: `
      <div class="w-72">
        <z-select [zMultiple]="true" zPlaceholder="Select ticket tiers...">
          <z-select-item zValue="general">General Admission</z-select-item>
          <z-select-item zValue="vip">VIP Access</z-select-item>
          <z-select-item zValue="backstage">Backstage Pass</z-select-item>
          <z-select-item zValue="early">Early Entry</z-select-item>
        </z-select>
      </div>
    `,
    moduleMetadata: {
      imports: [ZardSelectItemComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven multi-select treatment. The app uses this pattern for selected-value chips and grouped option picking rather than relying on a custom alternative.',
      },
    },
  },
};

export const WithDisabledItem: Story = {
  render: () => ({
    props: {},
    template: `
      <div class="w-64">
        <z-select zPlaceholder="Select ticket type...">
          <z-select-item zValue="general">General Admission</z-select-item>
          <z-select-item zValue="vip">VIP Access</z-select-item>
          <z-select-item zValue="backstage" [zDisabled]="true">Backstage Pass (Sold Out)</z-select-item>
        </z-select>
      </div>
    `,
    moduleMetadata: {
      imports: [ZardSelectItemComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven option-list state where one or more choices remain visible but unavailable.',
      },
    },
  },
};

export const ControlledSelection: Story = {
  render: () => ({
    props: {
      selectedValue: 'vip',
    },
    template: `
      <div class="w-80 space-y-3">
        <div class="space-y-1">
          <label for="controlled-select" class="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Ticket Tier
          </label>
          <z-select
            id="controlled-select"
            class="w-full"
            [zValue]="selectedValue"
            (zSelectionChange)="selectedValue = $event"
            zPlaceholder="Select a ticket tier..."
          >
            <z-select-item zValue="general">General Admission</z-select-item>
            <z-select-item zValue="vip">VIP Access</z-select-item>
            <z-select-item zValue="backstage">Backstage Pass</z-select-item>
          </z-select>
        </div>

        <p class="text-xs text-muted-foreground font-sans">
          Controlled selection mirrors how the guest type field is wired in the admin dialog.
          Current value: <span class="font-mono text-foreground">{{ selectedValue || 'none' }}</span>
        </p>
      </div>
    `,
    moduleMetadata: {
      imports: [ZardSelectItemComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven controlled field state matching the guest-type selection flow in admin dialogs.',
      },
    },
  },
};

export const ValidationState: Story = {
  render: () => ({
    props: {},
    template: `
      <div class="max-w-sm rounded-xl border border-border bg-card p-6 space-y-4">
        <div class="space-y-1">
          <label for="validation-select" class="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Guest Type *
          </label>
          <z-select
            id="validation-select"
            class="w-full border-destructive/50"
            zPlaceholder="Select guest type..."
          >
            <z-select-item zValue="guest">Guest</z-select-item>
            <z-select-item zValue="artist guest">Artist Guest</z-select-item>
            <z-select-item zValue="staff">Staff</z-select-item>
          </z-select>
          <p class="text-xs text-destructive uppercase tracking-wider">Guest type is required</p>
          <p class="text-xs text-muted-foreground font-sans">
            This matches the error-first composition used around required admin fields.
          </p>
        </div>
      </div>
    `,
    moduleMetadata: {
      imports: [ZardSelectItemComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story: 'App-proven error-first composition for required admin fields.',
      },
    },
  },
};

export const LongLabels: Story = {
  render: () => ({
    props: {},
    template: `
      <div class="w-72 space-y-3">
        <div class="space-y-1">
          <label for="long-label-select" class="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Ticket Tier
          </label>
          <z-select
            id="long-label-select"
            class="w-full"
            zValue="artist-guest"
            zPlaceholder="Select ticket tier..."
          >
            <z-select-item zValue="general">
              General Admission with Flexible Pricing and No Special Access
            </z-select-item>
            <z-select-item zValue="vip">
              VIP Access with Reserved Seating, Priority Entry, and Merch Bundle
            </z-select-item>
            <z-select-item zValue="artist-guest">
              Artist Guest Pass for Backstage Access and Check-In Coordination
            </z-select-item>
          </z-select>
        </div>
        <p class="text-xs text-muted-foreground font-sans">
          Long labels should still truncate cleanly inside the trigger and option rows.
        </p>
      </div>
    `,
    moduleMetadata: {
      imports: [ZardSelectItemComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven stress case for long ticket and guest labels inside triggers and open menus.',
      },
    },
  },
};

export const AdminFormComposition: Story = {
  render: () => ({
    props: {},
    template: `
      <div class="max-w-md rounded-xl border border-border bg-card p-6 space-y-6">
        <div class="space-y-1">
          <h2 class="font-display text-lg font-bold">Configure Ticket Access</h2>
          <p class="text-sm text-muted-foreground">Admin-style field grouping with labels, hints, and actions.</p>
        </div>

        <div class="space-y-5">
          <div class="space-y-2">
            <label for="admin-ticket-tier" class="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Ticket Tier
            </label>
            <z-select id="admin-ticket-tier" class="w-full" zPlaceholder="Select tier...">
              <z-select-item zValue="general">General Admission — $25</z-select-item>
              <z-select-item zValue="vip">VIP Access — $75</z-select-item>
              <z-select-item zValue="backstage">Backstage Pass — $150</z-select-item>
            </z-select>
            <p class="text-xs text-muted-foreground font-sans">
              Mirrors the select fields used in admin dialogs and event editor forms.
            </p>
          </div>

          <div class="space-y-2">
            <label for="admin-visibility" class="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Visibility Mode
            </label>
            <z-select id="admin-visibility" class="w-full" zPlaceholder="Select visibility...">
              <z-select-item zValue="private">Private Draft</z-select-item>
              <z-select-item zValue="review">Community Review</z-select-item>
              <z-select-item zValue="published">Published</z-select-item>
            </z-select>
          </div>
        </div>

        <div class="flex items-center justify-between gap-3 pt-2 border-t border-border">
          <div class="space-y-1">
            <p class="text-xs font-mono uppercase tracking-wider text-muted-foreground">Actions</p>
            <p class="text-xs text-muted-foreground">Use the same call-to-action spacing as the admin pages.</p>
          </div>
          <button z-button zType="default" class="shrink-0">
            Save Changes
          </button>
        </div>
      </div>
    `,
    moduleMetadata: {
      imports: [ZardButtonComponent, ZardSelectItemComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven admin form composition combining labels, hints, select fields, and action rows.',
      },
    },
  },
};
