import {Meta, StoryObj} from '@storybook/angular';
import {BraInventoryMeterComponent} from './inventory-meter.component';

const meta: Meta<BraInventoryMeterComponent> = {
  title: 'Braket/Composites/InventoryMeter',
  component: BraInventoryMeterComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Dual-segment inventory meter. Renders sold (solid primary), held/in-checkout (diagonal stripe violet), and free (muted base with tick marks). Used on the event management page so organizers can distinguish permanent sold capacity from transient open-order holds.',
      },
    },
  },
  argTypes: {
    soldCount: {control: {type: 'number', min: 0}},
    heldCount: {control: {type: 'number', min: 0}},
    totalTickets: {control: {type: 'number', min: 1}},
    label: {control: 'text'},
    testid: {
      control: 'text',
      description: 'Prefix used for the meter data-testid attributes.',
    },
  },
  args: {
    soldCount: 40,
    heldCount: 0,
    totalTickets: 100,
    label: 'Tickets Sold',
    testid: 'inventory-meter',
  },
  render: (args) => ({
    props: args,
    template: `
      <div class="mx-auto max-w-md p-8 bg-card border border-border rounded-xl">
        <bra-inventory-meter
          [soldCount]="soldCount"
          [heldCount]="heldCount"
          [totalTickets]="totalTickets"
          [label]="label"
          [testid]="testid"
        />
      </div>
    `,
  }),
};
export default meta;

type Story = StoryObj<BraInventoryMeterComponent>;

export const EarlySales: Story = {
  args: {soldCount: 12, heldCount: 0, totalTickets: 160},
  parameters: {
    docs: {
      description: {
        story:
          'App-proven early-sales state for event management before any checkout holds are present.',
      },
    },
  },
};

export const ActiveCheckouts: Story = {
  args: {soldCount: 84, heldCount: 6, totalTickets: 100},
  parameters: {
    docs: {
      description: {
        story:
          'Organizer can see that 90% of capacity is committed but 6 are still mid-checkout — they may free up if the orders expire.',
      },
    },
  },
};

export const SoldOutByHolds: Story = {
  args: {soldCount: 93, heldCount: 7, totalTickets: 100},
  parameters: {
    docs: {
      description: {
        story:
          'Capacity is fully reserved but 7 are pending — organizer knows some may release. Copy reflects this: "sold out · 7 in checkout".',
      },
    },
  },
};

export const FullySold: Story = {
  args: {soldCount: 100, heldCount: 0, totalTickets: 100},
  parameters: {
    docs: {
      description: {
        story:
          'All 100 tickets are permanently sold. No held segment. Status reads simply "sold out" — no ambiguity.',
      },
    },
  },
};

export const MostlyHeld: Story = {
  args: {soldCount: 10, heldCount: 40, totalTickets: 100},
  parameters: {
    docs: {
      description: {
        story:
          'Stress test: many active checkouts relative to completed sales. The stripe segment dominates to signal volatility.',
      },
    },
  },
};
