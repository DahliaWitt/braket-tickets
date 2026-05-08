import type { Meta, StoryObj } from '@storybook/angular';
import { argsToTemplate } from '@storybook/angular';

import { ZardBadgeComponent } from './badge.component';

const meta: Meta<ZardBadgeComponent> = {
  title: 'Braket/Primitives/Badge',
  component: ZardBadgeComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Badge is currently used in product mostly as a supporting primitive inside other controls such as selected-value chips in multi-select. The standalone badge compositions below are library-reference patterns for compact metadata and lightweight state labels.',
      },
    },
  },
  argTypes: {
    zType: {
      control: 'select',
      options: ['default', 'secondary', 'destructive', 'success', 'warning', 'info', 'outline'],
    },
    zAppearance: {
      control: 'select',
      options: ['solid', 'soft'],
    },
    zShape: {
      control: 'select',
      options: ['default', 'square', 'pill'],
    },
  },
  render: (args) => ({
    props: args,
    template: `<z-badge ${argsToTemplate(args)}>Badge</z-badge>`,
  }),
};

export default meta;
type Story = StoryObj<ZardBadgeComponent>;

export const Default: Story = {
  args: {
    zType: 'default',
    zAppearance: 'solid',
    zShape: 'default',
  },
  parameters: {
    docs: {
      description: {
        story: 'Reference playground for the base badge API and visual tokens.',
      },
    },
  },
};

export const EventMetadataChips: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Event metadata
          </p>
          <h3 class="text-lg font-semibold">Badges work well as compact chips inside cards and lists</h3>
        </div>

        <div class="flex flex-wrap gap-2">
          <z-badge zType="default" zShape="pill">General Admission</z-badge>
          <z-badge zType="secondary" zShape="pill">VIP</z-badge>
          <z-badge zType="outline" zShape="pill">Members Only</z-badge>
          <z-badge zType="warning" zShape="pill">Sold Out</z-badge>
          <z-badge zType="info" zShape="pill">Waitlist Open</z-badge>
        </div>
      </div>
    `,
    moduleMetadata: { imports: [ZardBadgeComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for compact metadata chips inside cards and list rows. Useful when a feature needs fast visual scanning, even though this exact event-metadata treatment is not a current app-proven surface.',
      },
    },
  },
};

export const AdminStatusChips: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Admin states
          </p>
          <h3 class="text-lg font-semibold">Use badges for lightweight state, not for full status messaging</h3>
        </div>

        <div class="flex flex-wrap gap-2">
          <z-badge zType="outline">Draft</z-badge>
          <z-badge zType="secondary">Pending review</z-badge>
          <z-badge zType="success">Active</z-badge>
          <z-badge zType="warning">Paused</z-badge>
          <z-badge zType="destructive">Rejected</z-badge>
        </div>
      </div>
    `,
    moduleMetadata: { imports: [ZardBadgeComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for lightweight state labels. Use this when a feature needs a terse status chip rather than a fuller status block or alert.',
      },
    },
  },
};

export const TagPills: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Filter and tag chips
          </p>
          <h3 class="text-lg font-semibold">Pills make filters and tags easier to scan at a glance</h3>
        </div>

        <div class="flex flex-wrap gap-2">
          <z-badge zType="default" zShape="square">EDM</z-badge>
          <z-badge zType="secondary" zShape="square">Underground</z-badge>
          <z-badge zType="outline" zShape="square">Brooklyn</z-badge>
          <z-badge zType="info" zShape="square">21+</z-badge>
          <z-badge zType="success" zShape="square">Verified</z-badge>
        </div>
      </div>
    `,
    moduleMetadata: { imports: [ZardBadgeComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for tags and filters. This shape is supported, but the app currently uses badge more often as a supporting primitive inside composite controls.',
      },
    },
  },
};
