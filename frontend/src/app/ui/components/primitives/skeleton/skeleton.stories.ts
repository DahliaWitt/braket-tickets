import type {Meta, StoryObj} from '@storybook/angular';

import {ZardSkeletonComponent} from './skeleton.component';

const meta: Meta<ZardSkeletonComponent> = {
  title: 'Braket/Primitives/Skeleton',
  component: ZardSkeletonComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Skeleton is app-proven for loading placeholders across landing, dashboard, and admin data surfaces. The stories document the actual product loading shapes rather than abstract gray boxes alone.',
      },
    },
  },
  argTypes: {
    width: {
      control: 'text',
      description: 'Inline width applied to the skeleton placeholder.',
    },
    height: {
      control: 'text',
      description: 'Inline height applied to the skeleton placeholder.',
    },
    zAnimation: {
      control: 'select',
      options: ['pulse', 'shimmer'],
      description: 'Loading animation style for the placeholder.',
    },
  },
  args: {
    width: '12rem',
    height: '1rem',
    zAnimation: 'pulse',
  },
  render: (args) => ({
    props: args,
    template: `<z-skeleton [width]="width" [height]="height" [zAnimation]="zAnimation" />`,
  }),
};

export default meta;
type Story = StoryObj<ZardSkeletonComponent>;

export const SingleLine: Story = {
  parameters: {
    docs: {
      description: {
        story: 'Reference baseline for a single text-line placeholder.',
      },
    },
  },
};

export const ShimmerSingleLine: Story = {
  render: () => ({
    template: `<z-skeleton class="h-4 w-48" zAnimation="shimmer" />`,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Shimmer animation variant — left-to-right gradient sweep for enhanced perceived performance.',
      },
    },
  },
};

export const ShimmerCardGrid: Story = {
  render: () => ({
    template: `
      <div class="grid gap-6 md:grid-cols-3">
        @for (i of [1, 2, 3]; track i) {
          <div class="rounded-xl border border-border bg-card p-6 space-y-4">
            <z-skeleton class="h-16 w-16 rounded-lg" zAnimation="shimmer" />
            <z-skeleton class="h-5 w-3/4" zAnimation="shimmer" />
            <div class="space-y-2">
              <z-skeleton class="h-3 w-full" zAnimation="shimmer" />
              <z-skeleton class="h-3 w-5/6" zAnimation="shimmer" />
              <z-skeleton class="h-3 w-2/3" zAnimation="shimmer" />
            </div>
            <z-skeleton class="h-3 w-24" zAnimation="shimmer" />
          </div>
        }
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Shimmer card grid matching the community directory loading pattern.',
      },
    },
  },
};

export const CommunityEventsLoading: Story = {
  render: () => ({
    template: `
      <div class="grid gap-6 md:grid-cols-2">
        <div class="h-[400px] overflow-hidden rounded-xl border border-border bg-card">
          <z-skeleton zAnimation="shimmer" class="h-1/2 w-full rounded-none" />
          <div class="space-y-4 p-6">
            <z-skeleton zAnimation="shimmer" class="h-8 w-3/4" />
            <div class="flex justify-between gap-4">
              <z-skeleton zAnimation="shimmer" class="h-4 w-24" />
              <z-skeleton zAnimation="shimmer" class="h-4 w-32" />
            </div>
            <z-skeleton zAnimation="shimmer" class="h-20 w-full" />
            <div class="flex gap-4 pt-4 border-t border-border">
              <z-skeleton zAnimation="shimmer" class="h-10 flex-1" />
              <z-skeleton zAnimation="shimmer" class="h-10 flex-1" />
            </div>
          </div>
        </div>

        <div class="hidden h-[400px] overflow-hidden rounded-xl border border-border bg-card md:block">
          <z-skeleton zAnimation="shimmer" class="h-1/2 w-full rounded-none" />
          <div class="space-y-4 p-6">
            <z-skeleton zAnimation="shimmer" class="h-8 w-3/4" />
            <div class="flex justify-between gap-4">
              <z-skeleton zAnimation="shimmer" class="h-4 w-24" />
              <z-skeleton zAnimation="shimmer" class="h-4 w-32" />
            </div>
            <z-skeleton zAnimation="shimmer" class="h-20 w-full" />
            <div class="flex gap-4 pt-4 border-t border-border">
              <z-skeleton zAnimation="shimmer" class="h-10 flex-1" />
              <z-skeleton zAnimation="shimmer" class="h-10 flex-1" />
            </div>
          </div>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven event-card loading grid for discovery and community event surfaces.',
      },
    },
  },
};

export const DashboardLoading: Story = {
  render: () => ({
    template: `
      <div class="space-y-6 rounded-xl border border-border bg-card p-6">
        <div class="space-y-3">
          <z-skeleton zAnimation="shimmer" class="h-3 w-40" />
          <div class="grid gap-3 md:grid-cols-3">
            <div class="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
              <z-skeleton zAnimation="shimmer" class="h-4 w-24" />
              <z-skeleton zAnimation="shimmer" class="h-8 w-16" />
            </div>
            <div class="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
              <z-skeleton zAnimation="shimmer" class="h-4 w-24" />
              <z-skeleton zAnimation="shimmer" class="h-8 w-20" />
            </div>
            <div class="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
              <z-skeleton zAnimation="shimmer" class="h-4 w-24" />
              <z-skeleton zAnimation="shimmer" class="h-8 w-12" />
            </div>
          </div>
        </div>

        <div class="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
          <z-skeleton zAnimation="shimmer" class="h-6 w-3/4" />
          <z-skeleton zAnimation="shimmer" class="h-4 w-1/2" />
          <z-skeleton zAnimation="shimmer" class="h-20 w-full" />
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven dashboard placeholder pattern for metric summaries and content cards.',
      },
    },
  },
};

export const AuditLogLoading: Story = {
  render: () => ({
    template: `
      <div class="space-y-3 rounded-xl border border-border bg-card p-4">
        <div class="grid grid-cols-[6rem_10rem_1fr_1.4fr] gap-4 border-b border-border pb-3 text-2xs uppercase tracking-widest text-muted-foreground">
          <span>Time</span>
          <span>Admin</span>
          <span>Action</span>
          <span>Details</span>
        </div>

        @for (row of [1, 2, 3, 4]; track row) {
          <div class="grid grid-cols-[6rem_10rem_1fr_1.4fr] gap-4 items-center py-3">
            <z-skeleton zAnimation="shimmer" class="h-3 w-20" />
            <z-skeleton zAnimation="shimmer" class="h-3 w-28" />
            <div class="flex items-center gap-2">
              <z-skeleton zAnimation="shimmer" class="h-4 w-4 rounded" />
              <z-skeleton zAnimation="shimmer" class="h-3 w-32" />
            </div>
            <z-skeleton zAnimation="shimmer" class="h-3 w-40" />
          </div>
        }
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven loading treatment for audit-log and tabular admin surfaces.',
      },
    },
  },
};
