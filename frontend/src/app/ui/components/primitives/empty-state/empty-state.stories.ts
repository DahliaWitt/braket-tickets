import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';

import { ContentLayoutComponent } from '@/layout/content-layout/content-layout.component';
import { EmptyStateComponent } from './empty-state.component';
import { ZardIconComponent } from '@ui/components/primitives/icon/icon.component';

const meta: Meta<EmptyStateComponent> = {
  title: 'Braket/Primitives/EmptyState',
  component: EmptyStateComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Empty state is app-proven across ticketing, help, and admin surfaces. These stories document the product layouts it actually inhabits, plus the smaller status-only mode used for accessible loading and announcement states.',
      },
    },
  },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    isStatus: { control: 'boolean' },
    ariaLabel: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<EmptyStateComponent>;

export const Actionless: Story = {
  args: {
    title: 'No tickets found',
    description: "You haven't purchased any tickets yet.",
  },
  parameters: {
    docs: {
      description: {
        story:
          'App-proven baseline message for simple no-data states where the page does not need an additional call to action.',
      },
    },
  },
};

@Component({
  selector: 'bt-story-empty-state-table-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent],
  template: `
    <div class="max-w-3xl rounded-xl border border-border bg-card/80 overflow-hidden">
      <div class="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <span class="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Members
        </span>
        <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
          0 results
        </span>
      </div>
      <app-empty-state
        title="No members found"
        description="Try widening the filter or inviting a new member."
      ></app-empty-state>
    </div>
  `,
})
class EmptyStateTableShellComponent {}

export const TableFallback: Story = {
  render: () => ({
    template: `<bt-story-empty-state-table-shell />`,
    moduleMetadata: {
      imports: [EmptyStateTableShellComponent],
    },
  }),
  parameters: {
    docs: {
      description: {
        story: 'App-proven empty table treatment for filtered admin or membership lists.',
      },
    },
  },
};

@Component({
  selector: 'bt-story-empty-state-page-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContentLayoutComponent, EmptyStateComponent, ZardIconComponent],
  template: `
    <app-content-layout>
      <ng-container header>
        <header class="px-6 md:px-12 py-4 border-b border-border flex items-center justify-between">
          <span class="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            My tickets
          </span>
        </header>
      </ng-container>

      <div class="py-12 md:py-16">
        <app-empty-state
          title="No tickets found"
          description="You have not purchased any tickets for this event yet."
        >
          <z-icon icon zType="tag" class="w-10 h-10 text-muted-foreground/60" />
        </app-empty-state>
      </div>
    </app-content-layout>
  `,
})
class EmptyStatePageShellComponent {}

export const PageFallback: Story = {
  render: () => ({
    template: `<bt-story-empty-state-page-shell />`,
    moduleMetadata: {
      imports: [EmptyStatePageShellComponent],
    },
  }),
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        story:
          'App-proven full-page fallback for ticketing and account surfaces where the empty state owns the main content area.',
      },
    },
  },
};

export const StatusAnnouncement: Story = {
  args: {
    title: 'Loading results',
    description: 'Please wait while we fetch your data.',
    isStatus: true,
    ariaLabel: 'Loading state',
  },
  parameters: {
    docs: {
      description: {
        story:
          'App-proven status-only mode for accessible loading or announcement states where the component should be announced without acting like a decorative empty view.',
      },
    },
  },
};
