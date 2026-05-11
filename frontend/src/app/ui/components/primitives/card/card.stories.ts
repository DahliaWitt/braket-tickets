import type {Meta, StoryObj} from '@storybook/angular';
import {argsToTemplate} from '@storybook/angular';

import {ZardBadgeComponent} from '@ui/components/primitives/badge/badge.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardCardComponent} from './card.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {ZardProgressBarComponent} from '@ui/components/primitives/progress-bar/progress-bar.component';

const meta: Meta<ZardCardComponent> = {
  title: 'Braket/Primitives/Card',
  component: ZardCardComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Card is app-proven as the main content container for admin sections, ticketing modules, and summary surfaces. These stories distinguish the real product compositions from the simpler reference baseline.',
      },
    },
  },
  argTypes: {
    zTitle: {control: 'text'},
    zDescription: {control: 'text'},
    zAction: {control: 'text'},
    zActionAriaLabel: {control: 'text'},
    zHeaderBorder: {control: 'boolean'},
    zFooterBorder: {control: 'boolean'},
    zVariant: {
      control: 'select',
      options: ['default', 'horizontal'],
      description:
        'Layout variant for default stacked cards or horizontal media cards.',
    },
  },
  render: (args) => ({
    props: args,
    template: `<z-card class="border-border bg-card/80" ${argsToTemplate(args)}>Card content</z-card>`,
  }),
};

export default meta;
type Story = StoryObj<ZardCardComponent>;

export const Default: Story = {
  args: {
    zTitle: 'Section title',
    zDescription: 'Card content used as a Braket container.',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Reference baseline for the primitive card API with title and description props.',
      },
    },
  },
};

export const AdminSection: Story = {
  render: () => ({
    template: `
      <z-card
        class="border-border bg-card/80"
        zTitle="Event summary"
        zDescription="Admin metrics for the current event"
        zAction="Edit"
        zActionAriaLabel="Edit event summary"
        [zHeaderBorder]="true"
        [zFooterBorder]="true"
      >
        <div class="grid gap-3 sm:grid-cols-3">
          <div class="rounded-lg border border-border/60 bg-muted/40 p-4">
            <p class="text-2xs font-mono uppercase tracking-widest text-muted-foreground">Sold</p>
            <p class="mt-2 font-display text-2xl text-foreground">72</p>
          </div>
          <div class="rounded-lg border border-border/60 bg-muted/40 p-4">
            <p class="text-2xs font-mono uppercase tracking-widest text-muted-foreground">Checked in</p>
            <p class="mt-2 font-display text-2xl text-success">55</p>
          </div>
          <div class="rounded-lg border border-border/60 bg-muted/40 p-4">
            <p class="text-2xs font-mono uppercase tracking-widest text-muted-foreground">Pending</p>
            <p class="mt-2 font-display text-2xl text-warning">17</p>
          </div>
        </div>

        <div class="mt-6 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-2xs font-mono uppercase tracking-widest text-muted-foreground">
              Capacity
            </span>
            <span class="text-2xs font-mono text-muted-foreground">72 / 100</span>
          </div>
          <z-progress-bar [progress]="72" />
        </div>

        <div card-footer class="w-full pt-2">
          <p class="text-xs font-mono uppercase tracking-widest text-muted-foreground">
            Updated 5 minutes ago
          </p>
        </div>
      </z-card>
    `,
    moduleMetadata: {
      imports: [ZardCardComponent, ZardProgressBarComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven admin summary composition with metrics, progress, and footer metadata.',
      },
    },
  },
};

export const ProductCallout: Story = {
  render: () => ({
    template: `
      <z-card
        class="border-border bg-card/80"
        zTitle="Reserve your spot"
        zDescription="Ticket purchase flow with footer actions"
        [zFooterBorder]="true"
      >
        <div class="space-y-4">
          <div class="flex items-end justify-between gap-4">
            <div class="space-y-1">
              <p class="text-2xs font-mono uppercase tracking-widest text-muted-foreground">
                General admission
              </p>
              <p class="font-display text-3xl text-foreground">$35</p>
            </div>
            <z-badge zType="secondary" zShape="pill">Members only</z-badge>
          </div>
          <p class="text-sm text-muted-foreground">
            This mirrors the product-facing cards used in tickets and checkout, where the card
            body carries the state and the footer carries the action.
          </p>
        </div>

        <div card-footer class="flex w-full gap-3 pt-2">
          <a z-button zType="ghost" href="/community-admin/events" class="flex-1">
            Back to events
          </a>
          <button type="button" z-button zType="default" class="flex-1">
            <z-icon zType="tag" />
            Reserve ticket
          </button>
        </div>
      </z-card>
    `,
    moduleMetadata: {
      imports: [
        ZardBadgeComponent,
        ZardButtonComponent,
        ZardCardComponent,
        ZardIconComponent,
      ],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven product-facing callout card where the body carries pricing state and the footer carries the primary action.',
      },
    },
  },
};

export const ContentOnly: Story = {
  render: () => ({
    template: `
      <z-card
        class="border-border bg-card/80"
        zTitle="Event status"
        zDescription="Actionless content card with projected content"
      >
        <div class="flex flex-col gap-3">
          <p class="text-sm text-muted-foreground">
            The vetting application is under review and no action is available yet.
          </p>
          <div class="flex flex-wrap gap-2">
            <z-badge zType="secondary" zShape="pill">Under review</z-badge>
            <z-badge zType="outline">Awaiting approval</z-badge>
          </div>
        </div>
      </z-card>
    `,
    moduleMetadata: {
      imports: [ZardBadgeComponent, ZardCardComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven informational card state for read-only status and review surfaces with no footer action.',
      },
    },
  },
};
