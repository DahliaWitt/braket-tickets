import {ChangeDetectionStrategy, Component} from '@angular/core';
import type {Meta, StoryObj} from '@storybook/angular';

import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';

import {ZardPopoverComponent, ZardPopoverDirective} from './popover.component';

@Component({
  selector: 'bt-story-popover-audit-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardPopoverDirective, ZardPopoverComponent],
  template: `
    <div class="space-y-4 rounded-xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p
          class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
        >
          Audit log detail
        </p>
        <h3 class="text-lg font-semibold">
          Hover for the row summary Braket shows in admin tables
        </h3>
      </div>

      <div class="rounded-lg border border-border/60 bg-muted/20 p-4">
        <div class="flex items-center justify-between gap-4">
          <div class="space-y-1">
            <p
              class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
            >
              Action
            </p>
            <span
              zPopover
              [zContent]="detail"
              zTrigger="hover"
              zPlacement="bottom"
              tabindex="0"
              class="cursor-pointer border-b border-dashed border-primary text-sm text-foreground"
            >
              Updated event check-in window
            </span>
          </div>
          <z-button zType="outline" zShape="circle" aria-label="More details">
            <span class="text-xs tracking-widest uppercase">i</span>
          </z-button>
        </div>
      </div>

      <ng-template #detail>
        <z-popover>
          <div class="min-w-64 space-y-2">
            <p class="text-sm font-semibold">Audit log detail</p>
            <dl class="grid gap-1 text-xs text-muted-foreground">
              <div class="flex justify-between gap-4">
                <dt class="tracking-widest uppercase">Admin</dt>
                <dd>Casey</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="tracking-widest uppercase">Timestamp</dt>
                <dd>12m ago</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="tracking-widest uppercase">Source</dt>
                <dd>community-admin</dd>
              </div>
            </dl>
          </div>
        </z-popover>
      </ng-template>
    </div>
  `,
})
class PopoverAuditLogStoryComponent {}

@Component({
  selector: 'bt-story-popover-event-info',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardPopoverDirective, ZardPopoverComponent],
  template: `
    <div class="space-y-4 rounded-xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p
          class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
        >
          Event details
        </p>
        <h3 class="text-lg font-semibold">
          Click-triggered popovers work well for compact metadata
        </h3>
      </div>

      <ng-template #content>
        <z-popover>
          <div class="min-w-56 space-y-3">
            <div>
              <p class="text-sm font-semibold">Void Sessions Vol. 12</p>
              <p class="text-xs text-muted-foreground">The Bunker, Brooklyn</p>
            </div>
            <div class="grid gap-1 text-xs text-muted-foreground">
              <p>Doors: 10pm</p>
              <p>Capacity: 72 / 100</p>
              <p>Tickets: General Admission, VIP</p>
            </div>
          </div>
        </z-popover>
      </ng-template>

      <button
        z-button
        zType="outline"
        zPopover
        [zContent]="content"
        zTrigger="click"
        zPlacement="bottom"
      >
        Event info
      </button>
    </div>
  `,
})
class PopoverEventInfoStoryComponent {}

@Component({
  selector: 'bt-story-popover-open-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardPopoverDirective, ZardPopoverComponent],
  template: `
    <div class="space-y-4 rounded-xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p
          class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
        >
          Open state
        </p>
        <h3 class="text-lg font-semibold">
          Use zVisible to document the rendered panel itself
        </h3>
      </div>

      <ng-template #content>
        <z-popover>
          <div class="min-w-56 space-y-2">
            <p class="text-sm font-semibold">Theme settings</p>
            <p class="text-xs text-muted-foreground">
              This matches the dropdown-style content used in the theme
              switcher.
            </p>
          </div>
        </z-popover>
      </ng-template>

      <button
        z-button
        zType="ghost"
        zPopover
        [zContent]="content"
        [zVisible]="true"
        zTrigger="click"
        zPlacement="right"
      >
        Open preview
      </button>
    </div>
  `,
})
class PopoverOpenStateStoryComponent {}

const meta: Meta = {
  title: 'Braket/Primitives/Popover',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Popover primitive stories separate app-proven compact metadata usage from open-state reference coverage.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const AuditLogDetail: Story = {
  render: () => ({
    template: `<bt-story-popover-audit-log />`,
    moduleMetadata: {imports: [PopoverAuditLogStoryComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven compact detail pattern for audit-log style admin table rows.',
      },
    },
  },
};

export const EventInfo: Story = {
  render: () => ({
    template: `<bt-story-popover-event-info />`,
    moduleMetadata: {imports: [PopoverEventInfoStoryComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for click-triggered event metadata in a compact panel.',
      },
    },
  },
};

export const OpenState: Story = {
  render: () => ({
    template: `<bt-story-popover-open-state />`,
    moduleMetadata: {imports: [PopoverOpenStateStoryComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Shows the panel in its expanded state so designers can review spacing, shadow, and content density.',
      },
    },
  },
};
