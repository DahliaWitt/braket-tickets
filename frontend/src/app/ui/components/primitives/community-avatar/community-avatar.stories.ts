import type {Meta, StoryObj} from '@storybook/angular';
import {argsToTemplate} from '@storybook/angular';

import {BraCommunityAvatarComponent} from './community-avatar.component';

const meta: Meta<BraCommunityAvatarComponent> = {
  title: 'Braket/Primitives/CommunityAvatar',
  component: BraCommunityAvatarComponent,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
    },
    shape: {
      control: 'select',
      options: ['rounded', 'circle', 'rounded-lg'],
    },
    muted: {control: 'boolean'},
  },
};

export default meta;
type Story = StoryObj<BraCommunityAvatarComponent>;

export const WithImage: Story = {
  args: {
    name: 'Braket',
    logoUrl: 'https://picsum.photos/seed/braket/128/128',
    size: 'lg',
    shape: 'rounded',
  },
  render: (args) => ({
    props: args,
    template: `<bra-community-avatar ${argsToTemplate(args)} />`,
  }),
};

export const Fallback: Story = {
  args: {name: 'Braket', size: 'lg', shape: 'rounded'},
  render: (args) => ({
    props: args,
    template: `<bra-community-avatar ${argsToTemplate(args)} />`,
  }),
};

export const FallbackMuted: Story = {
  args: {name: 'Braket', size: 'lg', shape: 'rounded', muted: true},
  render: (args) => ({
    props: args,
    template: `<bra-community-avatar ${argsToTemplate(args)} />`,
  }),
};

export const Circle: Story = {
  args: {
    name: 'Braket',
    logoUrl: 'https://picsum.photos/seed/braket/128/128',
    size: 'sm',
    shape: 'circle',
  },
  render: (args) => ({
    props: args,
    template: `<bra-community-avatar ${argsToTemplate(args)} />`,
  }),
};

export const RoundedLg: Story = {
  args: {
    name: 'Braket',
    logoUrl: 'https://picsum.photos/seed/braket/128/128',
    size: '2xl',
    shape: 'rounded-lg',
  },
  render: (args) => ({
    props: args,
    template: `<bra-community-avatar ${argsToTemplate(args)} />`,
  }),
};

export const AllSizes: Story = {
  render: () => ({
    template: `
      <div class="flex items-end gap-4">
        <bra-community-avatar name="Braket" size="xs" />
        <bra-community-avatar name="Braket" size="sm" />
        <bra-community-avatar name="Braket" size="md" />
        <bra-community-avatar name="Braket" size="lg" />
        <bra-community-avatar name="Braket" size="xl" />
        <bra-community-avatar name="Braket" size="2xl" />
      </div>
    `,
    moduleMetadata: {imports: [BraCommunityAvatarComponent]},
  }),
};

export const AllSizesWithImage: Story = {
  render: () => ({
    template: `
      <div class="flex items-end gap-4">
        <bra-community-avatar name="Braket" logoUrl="https://picsum.photos/seed/braket/128/128" size="xs" />
        <bra-community-avatar name="Braket" logoUrl="https://picsum.photos/seed/braket/128/128" size="sm" />
        <bra-community-avatar name="Braket" logoUrl="https://picsum.photos/seed/braket/128/128" size="md" />
        <bra-community-avatar name="Braket" logoUrl="https://picsum.photos/seed/braket/128/128" size="lg" />
        <bra-community-avatar name="Braket" logoUrl="https://picsum.photos/seed/braket/128/128" size="xl" />
        <bra-community-avatar name="Braket" logoUrl="https://picsum.photos/seed/braket/128/128" size="2xl" />
      </div>
    `,
    moduleMetadata: {imports: [BraCommunityAvatarComponent]},
  }),
};

export const AllShapes: Story = {
  render: () => ({
    template: `
      <div class="flex items-end gap-4">
        <bra-community-avatar name="Braket" logoUrl="https://picsum.photos/seed/braket/128/128" size="lg" shape="rounded" />
        <bra-community-avatar name="Braket" logoUrl="https://picsum.photos/seed/braket/128/128" size="lg" shape="circle" />
        <bra-community-avatar name="Braket" logoUrl="https://picsum.photos/seed/braket/128/128" size="lg" shape="rounded-lg" />
      </div>
    `,
    moduleMetadata: {imports: [BraCommunityAvatarComponent]},
  }),
};

export const AllShapesFallback: Story = {
  render: () => ({
    template: `
      <div class="flex items-end gap-4">
        <bra-community-avatar name="Braket" size="lg" shape="rounded" />
        <bra-community-avatar name="Braket" size="lg" shape="circle" />
        <bra-community-avatar name="Braket" size="lg" shape="rounded-lg" />
      </div>
    `,
    moduleMetadata: {imports: [BraCommunityAvatarComponent]},
  }),
};

export const MutedAcrossSizes: Story = {
  render: () => ({
    template: `
      <div class="flex items-end gap-4">
        <bra-community-avatar name="Braket" size="xs" [muted]="true" />
        <bra-community-avatar name="Braket" size="sm" [muted]="true" />
        <bra-community-avatar name="Braket" size="md" [muted]="true" />
        <bra-community-avatar name="Braket" size="lg" [muted]="true" />
        <bra-community-avatar name="Braket" size="xl" [muted]="true" />
        <bra-community-avatar name="Braket" size="2xl" [muted]="true" />
      </div>
    `,
    moduleMetadata: {imports: [BraCommunityAvatarComponent]},
  }),
};
