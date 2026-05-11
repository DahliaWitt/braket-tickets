import type {Meta, StoryObj} from '@storybook/angular';
import {argsToTemplate} from '@storybook/angular';

import {ZardTabGroupComponent, ZardTabComponent} from './tabs.component';

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
      description: 'Visual treatment for the tab list and active tab.',
    },
    activeIndex: {
      control: {type: 'number', min: 0, max: 2, step: 1},
      description: 'Zero-based active tab index.',
    },
  },
  args: {
    zStyle: 'underline',
    activeIndex: 0,
  },
  render: (args) => ({
    props: args,
    template: `
      <z-tab-group ${argsToTemplate(args)}>
        <z-tab label="Account">Account settings and preferences.</z-tab>
        <z-tab label="Security">Password and two-factor authentication.</z-tab>
        <z-tab label="Notifications">Email and push notification preferences.</z-tab>
      </z-tab-group>
    `,
    moduleMetadata: {imports: [ZardTabGroupComponent, ZardTabComponent]},
  }),
};

export default meta;
type Story = StoryObj<ZardTabGroupComponent>;

export const Underline: Story = {
  args: {zStyle: 'underline', activeIndex: 0},
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for underline tabs in account-style settings surfaces.',
      },
    },
  },
};

export const Pill: Story = {
  args: {zStyle: 'pill', activeIndex: 0},
  render: (args) => ({
    props: args,
    template: `
      <z-tab-group ${argsToTemplate(args)}>
        <z-tab label="Overview">Event overview and statistics.</z-tab>
        <z-tab label="Tickets">Ticket tiers and pricing.</z-tab>
        <z-tab label="Guests">Guest list and check-in.</z-tab>
      </z-tab-group>
    `,
    moduleMetadata: {imports: [ZardTabGroupComponent, ZardTabComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for pill tabs in compact event-management groupings.',
      },
    },
  },
};
