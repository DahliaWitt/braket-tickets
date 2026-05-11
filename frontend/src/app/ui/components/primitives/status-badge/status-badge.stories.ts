import type {Meta, StoryObj} from '@storybook/angular';
import {argsToTemplate} from '@storybook/angular';

import {BraStatusBadgeComponent} from './status-badge.component';

const meta: Meta<BraStatusBadgeComponent> = {
  title: 'Braket/Primitives/StatusBadge',
  component: BraStatusBadgeComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Library-level primitive. Current app usage is limited, so this story keeps the supported status, size, and shape API explicit.',
      },
    },
  },
  argTypes: {
    status: {
      control: 'select',
      options: [
        'success',
        'warning',
        'destructive',
        'info',
        'muted',
        'primary',
        'secondary',
        'accent',
      ],
    },
    size: {
      control: 'select',
      options: ['sm', 'md'],
    },
    shape: {
      control: 'select',
      options: ['rounded', 'pill'],
    },
    live: {control: 'boolean'},
  },
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Status</bra-status-badge>`,
  }),
};

export default meta;
type Story = StoryObj<BraStatusBadgeComponent>;

export const Success: Story = {
  args: {status: 'success'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Active</bra-status-badge>`,
  }),
};

export const Warning: Story = {
  args: {status: 'warning'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Pending</bra-status-badge>`,
  }),
};

export const Destructive: Story = {
  args: {status: 'destructive'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Rejected</bra-status-badge>`,
  }),
};

export const Info: Story = {
  args: {status: 'info'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Info</bra-status-badge>`,
  }),
};

export const Muted: Story = {
  args: {status: 'muted'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Draft</bra-status-badge>`,
  }),
};

export const MediumSize: Story = {
  args: {status: 'success', size: 'md'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Active</bra-status-badge>`,
  }),
};

export const PillShape: Story = {
  args: {status: 'primary', shape: 'pill'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Featured</bra-status-badge>`,
  }),
};

export const Accent: Story = {
  args: {status: 'accent'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Accent</bra-status-badge>`,
  }),
};

export const AllStatuses: Story = {
  render: () => ({
    template: `
      <div class="flex flex-wrap gap-2">
        <bra-status-badge status="success">Active</bra-status-badge>
        <bra-status-badge status="warning">Pending</bra-status-badge>
        <bra-status-badge status="destructive">Rejected</bra-status-badge>
        <bra-status-badge status="info">Info</bra-status-badge>
        <bra-status-badge status="muted">Draft</bra-status-badge>
        <bra-status-badge status="primary">Featured</bra-status-badge>
        <bra-status-badge status="secondary">VIP</bra-status-badge>
        <bra-status-badge status="accent">Accent</bra-status-badge>
      </div>
    `,
    moduleMetadata: {imports: [BraStatusBadgeComponent]},
  }),
};
