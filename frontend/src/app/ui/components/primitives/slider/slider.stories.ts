import type { Meta, StoryObj } from '@storybook/angular';

import { ZardSliderComponent } from './slider.component';

const meta: Meta<ZardSliderComponent> = {
  title: 'Braket/Primitives/Slider',
  component: ZardSliderComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Slider is app-proven in the checkout sidebar, where buyers adjust supporter and sliding-scale amounts. The default stories mirror that pricing control, while the remaining variants document supported reference modes.',
      },
    },
  },
  argTypes: {
    zMin: { control: 'number' },
    zMax: { control: 'number' },
    zDefault: { control: 'number' },
    zValue: { control: 'number' },
    zStep: { control: 'number' },
    zDisabled: { control: 'boolean' },
    zOrientation: {
      control: 'select',
      options: ['horizontal', 'vertical'],
    },
  },
  render: (args) => ({
    props: args,
    template: `
      <div class="w-64">
        <z-slider
          [zMin]="zMin"
          [zMax]="zMax"
          [zDefault]="zDefault"
          [zStep]="zStep"
          [zDisabled]="zDisabled"
          [zOrientation]="zOrientation"
        />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<ZardSliderComponent>;

export const Default: Story = {
  args: {
    zMin: 0,
    zMax: 100,
    zValue: 35,
    zStep: 1,
    zDisabled: false,
    zOrientation: 'horizontal',
  },
  name: 'Checkout Pricing Control',
  render: (args) => ({
    props: {
      ...args,
      currentValue: args.zValue ?? args.zDefault ?? 35,
    },
    template: `
      <div class="w-80 space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            App-proven pattern
          </p>
          <h3 class="text-lg font-semibold">Supporter amount in checkout</h3>
          <p class="text-xs text-muted-foreground font-sans">
            Mirrors the checkout sidebar control used when buyers choose a supporter contribution.
          </p>
        </div>

        <z-slider
          class="w-full"
          [zMin]="zMin"
          [zMax]="zMax"
          [zValue]="currentValue"
          [zStep]="zStep"
          [zDisabled]="zDisabled"
          [zOrientation]="zOrientation"
          (zSlideIndexChange)="currentValue = $event"
        />

        <div class="flex items-center justify-between text-xs">
          <span class="font-mono uppercase tracking-wider text-muted-foreground">Contribution</span>
          <span class="font-mono text-foreground">\${{ currentValue }}</span>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven pricing control based on the checkout sidebar. The slider is controlled through `zValue` and updates a visible dollar amount as buyers adjust their contribution.',
      },
    },
  },
};

export const CustomRange: Story = {
  name: 'Community Pricing Range',
  args: {
    zMin: 1,
    zMax: 10,
    zDefault: 3,
    zStep: 1,
  },
  render: (args) => ({
    props: args,
    template: `
      <div class="flex flex-col gap-2 w-64">
        <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Ticket Quantity (1–10)</span>
        <z-slider [zMin]="zMin" [zMax]="zMax" [zDefault]="zDefault" [zStep]="zStep" />
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven range treatment for bounded pricing controls. This matches the same primitive behavior used for sliding-scale ticket amounts in checkout.',
      },
    },
  },
};

export const WithStep: Story = {
  name: 'Reference Stepped Value',
  args: {
    zMin: 0,
    zMax: 100,
    zDefault: 50,
    zStep: 10,
  },
  render: (args) => ({
    props: args,
    template: `
      <div class="flex flex-col gap-2 w-64">
        <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Volume (steps of 10)</span>
        <z-slider [zMin]="zMin" [zMax]="zMax" [zDefault]="zDefault" [zStep]="zStep" />
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for coarse step intervals. Supported by the primitive, but not the main product usage today.',
      },
    },
  },
};

export const Disabled: Story = {
  name: 'Reference Disabled State',
  args: {
    zMin: 0,
    zMax: 100,
    zDefault: 60,
    zDisabled: true,
  },
  render: (args) => ({
    props: args,
    template: `
      <div class="flex flex-col gap-2 w-64">
        <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Capacity (locked)</span>
        <z-slider [zMin]="zMin" [zMax]="zMax" [zDefault]="zDefault" [zDisabled]="zDisabled" />
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story: 'Reference state for locked controls after a workflow becomes read-only.',
      },
    },
  },
};

export const Vertical: Story = {
  name: 'Reference Vertical Orientation',
  args: {
    zMin: 0,
    zMax: 100,
    zDefault: 50,
    zOrientation: 'vertical',
  },
  render: (args) => ({
    props: args,
    template: `
      <div class="flex gap-6 h-48">
        <z-slider [zMin]="zMin" [zMax]="zMax" [zDefault]="zDefault" [zOrientation]="zOrientation" />
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for vertical sliders. Supported by the primitive, but not a current app-proven pattern.',
      },
    },
  },
};

export const AllVariants: Story = {
  name: 'Reference Overview',
  render: () => ({
    props: {},
    template: `
      <div class="flex flex-col gap-8">
        <div class="flex flex-col gap-2 w-64">
          <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Default (0–100)</span>
          <z-slider [zMin]="0" [zMax]="100" [zDefault]="30" />
        </div>

        <div class="flex flex-col gap-2 w-64">
          <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Custom Range (1–10, step 1)</span>
          <z-slider [zMin]="1" [zMax]="10" [zDefault]="4" [zStep]="1" />
        </div>

        <div class="flex flex-col gap-2 w-64">
          <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Stepped (0–100, step 25)</span>
          <z-slider [zMin]="0" [zMax]="100" [zDefault]="50" [zStep]="25" />
        </div>

        <div class="flex flex-col gap-2 w-64">
          <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Disabled</span>
          <z-slider [zMin]="0" [zMax]="100" [zDefault]="70" [zDisabled]="true" />
        </div>

        <div class="flex flex-col gap-2">
          <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Vertical</span>
          <div class="h-48">
            <z-slider [zMin]="0" [zMax]="100" [zDefault]="60" zOrientation="vertical" />
          </div>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Reference overview of the slider API across its supported ranges, stepping, disabled, and vertical modes.',
      },
    },
  },
};
