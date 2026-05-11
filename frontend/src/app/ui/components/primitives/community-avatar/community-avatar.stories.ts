import type {Meta, StoryObj} from '@storybook/angular';
import {argsToTemplate} from '@storybook/angular';

import {BraCommunityAvatarComponent} from './community-avatar.component';

const meta: Meta<BraCommunityAvatarComponent> = {
  title: 'Braket/Primitives/CommunityAvatar',
  component: BraCommunityAvatarComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'App-proven avatar primitive for community and organizer identity across directories, headers, and cards.',
      },
    },
  },
  argTypes: {
    name: {
      control: 'text',
      description:
        'Community name used for image alt text and fallback initials.',
    },
    logoUrl: {
      control: 'text',
      description:
        'Optional community logo URL; falls back to initials when absent or failed.',
    },
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

function storyDescription(story: string): Story['parameters'] {
  return {docs: {description: {story}}};
}

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
  parameters: storyDescription(
    'App-proven organizer avatar when a community logo URL is available.',
  ),
};

export const Fallback: Story = {
  args: {name: 'Braket', size: 'lg', shape: 'rounded'},
  render: (args) => ({
    props: args,
    template: `<bra-community-avatar ${argsToTemplate(args)} />`,
  }),
  parameters: storyDescription(
    'App-proven fallback initials when a community has no uploaded logo.',
  ),
};

export const FallbackMuted: Story = {
  args: {name: 'Braket', size: 'lg', shape: 'rounded', muted: true},
  render: (args) => ({
    props: args,
    template: `<bra-community-avatar ${argsToTemplate(args)} />`,
  }),
  parameters: storyDescription(
    'App-proven muted fallback for secondary or low-emphasis community listings.',
  ),
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
  parameters: storyDescription(
    'Library reference for circular avatar shape support.',
  ),
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
  parameters: storyDescription(
    'Library reference for the largest rounded avatar presentation.',
  ),
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
  parameters: storyDescription(
    'Library reference comparing every fallback avatar size.',
  ),
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
  parameters: storyDescription(
    'Library reference comparing every image avatar size.',
  ),
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
  parameters: storyDescription(
    'Library reference comparing supported image avatar shapes.',
  ),
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
  parameters: storyDescription(
    'Library reference comparing supported fallback avatar shapes.',
  ),
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
  parameters: storyDescription(
    'Library reference for muted fallback avatars across supported sizes.',
  ),
};
