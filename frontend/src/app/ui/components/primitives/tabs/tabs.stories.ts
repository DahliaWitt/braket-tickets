import type { Meta, StoryObj } from '@storybook/angular';

import { ZardTabGroupComponent, ZardTabComponent } from './tabs.component';

const meta: Meta<ZardTabGroupComponent> = {
  title: 'Braket/Primitives/Tabs',
  component: ZardTabGroupComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Library-level primitive. Current app usage is limited, so this story documents the canonical tab-group and tab composition API.',
      },
    },
  },
  argTypes: {
    zStyle: {
      control: 'select',
      options: ['underline', 'pill'],
    },
  },
};

export default meta;
type Story = StoryObj<ZardTabGroupComponent>;

export const Underline: Story = {
  render: () => ({
    template: `
      <z-tab-group zStyle="underline">
        <z-tab label="Account">Account settings and preferences.</z-tab>
        <z-tab label="Security">Password and two-factor authentication.</z-tab>
        <z-tab label="Notifications">Email and push notification preferences.</z-tab>
      </z-tab-group>
    `,
    moduleMetadata: { imports: [ZardTabGroupComponent, ZardTabComponent] },
  }),
};

export const Pill: Story = {
  render: () => ({
    template: `
      <z-tab-group zStyle="pill">
        <z-tab label="Overview">Event overview and statistics.</z-tab>
        <z-tab label="Tickets">Ticket tiers and pricing.</z-tab>
        <z-tab label="Guests">Guest list and check-in.</z-tab>
      </z-tab-group>
    `,
    moduleMetadata: { imports: [ZardTabGroupComponent, ZardTabComponent] },
  }),
};
