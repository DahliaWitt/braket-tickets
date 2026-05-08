import type { Meta, StoryObj } from '@storybook/angular';

import { ZardSwitchComponent } from './switch.component';

const meta: Meta<ZardSwitchComponent> = {
  title: 'Braket/Primitives/Switch',
  component: ZardSwitchComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Library-level primitive. Current app usage is limited, so this story is the canonical toggle reference for the switch API.',
      },
    },
  },
  argTypes: {
    zType: {
      control: 'select',
      options: ['default', 'destructive', 'success'],
    },
    zSize: {
      control: 'select',
      options: ['default', 'sm', 'lg'],
    },
    zDisabled: { control: 'boolean' },
  },
};

export default meta;
type Story = StoryObj<ZardSwitchComponent>;

export const Default: Story = {
  render: (args) => ({
    props: args,
    template: `<z-switch>Email notifications</z-switch>`,
    moduleMetadata: { imports: [ZardSwitchComponent] },
  }),
};

export const Checked: Story = {
  render: () => ({
    template: `<z-switch [zChecked]="true">Enabled</z-switch>`,
    moduleMetadata: { imports: [ZardSwitchComponent] },
  }),
};

export const Destructive: Story = {
  render: () => ({
    template: `<z-switch zType="destructive">Delete on exit</z-switch>`,
    moduleMetadata: { imports: [ZardSwitchComponent] },
  }),
};

export const Small: Story = {
  render: () => ({
    template: `<z-switch zSize="sm">Compact</z-switch>`,
    moduleMetadata: { imports: [ZardSwitchComponent] },
  }),
};

export const Disabled: Story = {
  render: () => ({
    template: `<z-switch [zDisabled]="true">Cannot toggle</z-switch>`,
    moduleMetadata: { imports: [ZardSwitchComponent] },
  }),
};
