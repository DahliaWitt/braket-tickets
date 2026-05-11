import type {Meta, StoryObj} from '@storybook/angular';
import {argsToTemplate} from '@storybook/angular';

import {ZardSwitchComponent} from './switch.component';

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
    zDisabled: {control: 'boolean'},
    zChecked: {
      control: 'boolean',
      description: 'Checked state for the switch control.',
    },
    zId: {
      control: 'text',
      description:
        'Explicit id for the switch button and projected label association.',
    },
  },
  args: {
    zType: 'default',
    zSize: 'default',
    zDisabled: false,
    zChecked: false,
    zId: '',
  },
};

export default meta;
type Story = StoryObj<ZardSwitchComponent>;

function storyDescription(story: string): Story['parameters'] {
  return {docs: {description: {story}}};
}

export const Default: Story = {
  render: (args) => ({
    props: args,
    template: `<z-switch ${argsToTemplate(args)}>Email notifications</z-switch>`,
    moduleMetadata: {imports: [ZardSwitchComponent]},
  }),
  parameters: storyDescription(
    'Library reference for the default switch API and unchecked state.',
  ),
};

export const Checked: Story = {
  render: () => ({
    template: `<z-switch [zChecked]="true">Enabled</z-switch>`,
    moduleMetadata: {imports: [ZardSwitchComponent]},
  }),
  parameters: storyDescription(
    'Library reference for a switch rendered in the checked state.',
  ),
};

export const Destructive: Story = {
  render: () => ({
    template: `<z-switch zType="destructive">Delete on exit</z-switch>`,
    moduleMetadata: {imports: [ZardSwitchComponent]},
  }),
  parameters: storyDescription(
    'Library reference for destructive switch styling.',
  ),
};

export const Small: Story = {
  render: () => ({
    template: `<z-switch zSize="sm">Compact</z-switch>`,
    moduleMetadata: {imports: [ZardSwitchComponent]},
  }),
  parameters: storyDescription(
    'Library reference for the compact switch size.',
  ),
};

export const Disabled: Story = {
  render: () => ({
    template: `<z-switch [zDisabled]="true">Cannot toggle</z-switch>`,
    moduleMetadata: {imports: [ZardSwitchComponent]},
  }),
  parameters: storyDescription(
    'Library reference for disabled switch affordance.',
  ),
};
