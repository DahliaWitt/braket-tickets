import type { Meta, StoryObj } from '@storybook/angular';
import { argsToTemplate } from '@storybook/angular';

import { ZardButtonComponent } from './button.component';
import { ZardIconComponent } from '@ui/components/primitives/icon/icon.component';

const meta: Meta<ZardButtonComponent> = {
  title: 'Braket/Primitives/Button',
  component: ZardButtonComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Button is app-proven across auth, admin, checkout, and navigation surfaces. These stories prioritize the product-real patterns the app depends on, with the default story left as a simple API playground.',
      },
    },
  },
  argTypes: {
    zType: {
      control: 'select',
      options: ['default', 'outline', 'ghost', 'link', 'destructive', 'secondary'],
    },
    zSize: {
      control: 'select',
      options: ['sm', 'default', 'lg'],
    },
    zShape: {
      control: 'select',
      options: ['default', 'circle', 'square'],
    },
    zLoading: { control: 'boolean' },
    zDisabled: { control: 'boolean' },
    zFull: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<button type="button" z-button ${argsToTemplate(args)}>Primary action</button>`,
  }),
};

export default meta;
type Story = StoryObj<ZardButtonComponent>;

export const Default: Story = {
  args: { zType: 'default', zSize: 'default' },
  parameters: {
    docs: {
      description: {
        story: 'Reference playground for the base button API and visual variants.',
      },
    },
  },
};

export const BackLink: Story = {
  render: () => ({
    template: `
      <div class="flex flex-wrap items-center gap-3">
        <a z-button zType="ghost" href="/community-admin/events" class="gap-2">
          <z-icon zType="arrow-left" />
          Back to Events
        </a>
        <a z-button zType="link" href="/community-admin" class="p-0">
          All Events
        </a>
      </div>
    `,
    moduleMetadata: {
      imports: [ZardIconComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven navigation treatment for returning to admin index pages and sibling views.',
      },
    },
  },
};

export const SubmitReady: Story = {
  render: () => ({
    template: `
      <div class="max-w-sm rounded-xl border border-border bg-card/80 p-5 space-y-4">
        <div class="space-y-1">
          <p class="text-xs uppercase font-mono tracking-widest text-muted-foreground">
            Admin form
          </p>
          <p class="text-sm text-muted-foreground">
            This mirrors the submit rows used in login, account, and admin forms.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" z-button zType="outline" class="flex-1">
            Cancel
          </button>
          <button type="submit" z-button zType="default" class="flex-1">
            Save changes
          </button>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven ready state for form action rows used in login, account, and admin forms.',
      },
    },
  },
};

export const SubmitLoading: Story = {
  render: () => ({
    template: `
      <div class="max-w-sm rounded-xl border border-border bg-card/80 p-5 space-y-4">
        <div class="space-y-1">
          <p class="text-xs uppercase font-mono tracking-widest text-muted-foreground">
            Async submit
          </p>
          <p class="text-sm text-muted-foreground">
            Loading state for submit buttons that block repeat actions while work is pending.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" z-button zType="outline" [zDisabled]="true" class="flex-1">
            Cancel
          </button>
          <button
            type="submit"
            z-button
            zType="default"
            [zLoading]="true"
            [zDisabled]="true"
            aria-busy="true"
            class="flex-1"
          >
            Saving changes
          </button>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven async submit state that blocks repeat actions while the request is in flight.',
      },
    },
  },
};

export const IconAction: Story = {
  render: () => ({
    template: `
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" z-button zType="outline" zShape="circle" aria-label="Copy ticket ID">
          <z-icon zType="copy" />
        </button>
        <button type="button" z-button zType="outline" class="gap-2">
          <z-icon zType="refresh-cw" />
          Refresh
        </button>
      </div>
    `,
    moduleMetadata: {
      imports: [ZardIconComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story: 'App-proven compact action pattern for copy, refresh, and similar utility actions.',
      },
    },
  },
};
