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

function storyDescription(story: string): Story['parameters'] {
  return {docs: {description: {story}}};
}

export const Success: Story = {
  args: {status: 'success'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Active</bra-status-badge>`,
  }),
  parameters: storyDescription(
    'Library reference for positive state labels such as active or approved.',
  ),
};

export const Warning: Story = {
  args: {status: 'warning'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Pending</bra-status-badge>`,
  }),
  parameters: storyDescription(
    'Library reference for pending or needs-attention status labels.',
  ),
};

export const Destructive: Story = {
  args: {status: 'destructive'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Rejected</bra-status-badge>`,
  }),
  parameters: storyDescription(
    'Library reference for rejected, failed, or destructive status labels.',
  ),
};

export const Info: Story = {
  args: {status: 'info'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Info</bra-status-badge>`,
  }),
  parameters: storyDescription(
    'Library reference for neutral informational labels.',
  ),
};

export const Muted: Story = {
  args: {status: 'muted'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Draft</bra-status-badge>`,
  }),
  parameters: storyDescription(
    'Library reference for passive labels such as draft or inactive.',
  ),
};

export const MediumSize: Story = {
  args: {status: 'success', size: 'md'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Active</bra-status-badge>`,
  }),
  parameters: storyDescription(
    'Library reference for the larger badge size in denser metadata rows.',
  ),
};

export const PillShape: Story = {
  args: {status: 'primary', shape: 'pill'},
  render: (args) => ({
    props: args,
    template: `<bra-status-badge ${argsToTemplate(args)}>Featured</bra-status-badge>`,
  }),
  parameters: storyDescription(
    'Library reference for rounded pill badges used when a label needs more emphasis.',
  ),
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
  parameters: storyDescription(
    'Library reference that compares every supported status token side by side.',
  ),
};
