import type {Meta, StoryObj} from '@storybook/angular';
import {argsToTemplate} from '@storybook/angular';

import {ZardProgressBarComponent} from './progress-bar.component';

const meta: Meta<ZardProgressBarComponent> = {
  title: 'Braket/Primitives/ProgressBar',
  component: ZardProgressBarComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Progress bar is app-proven in admin metrics, capacity summaries, and long-running operations like exports. The stories below prioritize those product-real patterns, with the grouped capacity states acting as a visual reference matrix.',
      },
    },
  },
  argTypes: {
    zType: {
      control: 'select',
      options: ['default', 'destructive', 'accent'],
    },
    zSize: {
      control: 'select',
      options: ['default', 'sm', 'lg'],
    },
    zShape: {
      control: 'select',
      options: ['default', 'square'],
    },
    zIndeterminate: {control: 'boolean'},
    progress: {control: {type: 'range', min: 0, max: 100, step: 1}},
    zAriaLabel: {control: 'text'},
    barClass: {
      control: 'text',
      description:
        'Additional classes applied to the inner progress indicator.',
    },
  },
  render: (args) => ({
    props: args,
    template: `<z-progress-bar ${argsToTemplate(args)} />`,
  }),
};

export default meta;
type Story = StoryObj<ZardProgressBarComponent>;

export const CapacityOverview: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Event capacity
          </p>
          <h3 class="text-lg font-semibold">Ticket sales and check-in progress at a glance</h3>
        </div>

        <div class="space-y-4">
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-4">
              <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
                Tickets sold
              </span>
              <span class="font-mono text-2xs text-muted-foreground">72 / 100</span>
            </div>
            <z-progress-bar zType="accent" [progress]="72" />
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-4">
              <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
                Check-ins
              </span>
              <span class="font-mono text-2xs text-muted-foreground">41 / 72</span>
            </div>
            <z-progress-bar [progress]="57" />
          </div>
        </div>
      </div>
    `,
    moduleMetadata: {imports: [ZardProgressBarComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven event-capacity and check-in summary treatment for admin dashboards and cards.',
      },
    },
  },
};

export const ExportProgress: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Long-running action
          </p>
          <h3 class="text-lg font-semibold">Indeterminate progress for exports and uploads</h3>
          <p class="text-sm text-muted-foreground">
            Use the loading state when Braket is waiting on a backend task and the percentage is
            not yet known.
          </p>
        </div>

        <z-progress-bar [zIndeterminate]="true" zAriaLabel="Export in progress" />
      </div>
    `,
    moduleMetadata: {imports: [ZardProgressBarComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven indeterminate loading state for long-running backend tasks like exports or uploads.',
      },
    },
  },
};

export const CapacityStates: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Capacity states
          </p>
          <h3 class="text-lg font-semibold">Use different colors to surface healthy, warning, and critical states</h3>
        </div>

        <div class="space-y-3">
          <div class="space-y-1">
            <div class="flex items-center justify-between gap-4">
              <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Healthy</span>
              <span class="font-mono text-2xs text-muted-foreground">60%</span>
            </div>
            <z-progress-bar [progress]="60" />
          </div>

          <div class="space-y-1">
            <div class="flex items-center justify-between gap-4">
              <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Warning</span>
              <span class="font-mono text-2xs text-muted-foreground">82%</span>
            </div>
            <z-progress-bar zType="accent" [progress]="82" />
          </div>

          <div class="space-y-1">
            <div class="flex items-center justify-between gap-4">
              <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Critical</span>
              <span class="font-mono text-2xs text-muted-foreground">96%</span>
            </div>
            <z-progress-bar zType="destructive" [progress]="96" />
          </div>
        </div>
      </div>
    `,
    moduleMetadata: {imports: [ZardProgressBarComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Reference overview of healthy, warning, and critical progress color treatments.',
      },
    },
  },
};
