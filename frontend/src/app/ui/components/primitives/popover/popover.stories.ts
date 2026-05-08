import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';

import { ZardButtonComponent } from '@ui/components/primitives/button/button.component';

import { ZardPopoverComponent, ZardPopoverDirective } from './popover.component';

@Component({
  selector: 'bt-story-popover-audit-log',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardPopoverDirective, ZardPopoverComponent],
  template: `
    <div class="space-y-4 rounded-xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
          Audit log detail
        </p>
        <h3 class="text-lg font-semibold">
          Hover for the row summary Braket shows in admin tables
        </h3>
      </div>

      <div class="rounded-lg border border-border/60 bg-muted/20 p-4">
        <div class="flex items-center justify-between gap-4">
          <div class="space-y-1">
            <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Action</p>
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
            <span class="text-xs uppercase tracking-widest">i</span>
          </z-button>
        </div>
      </div>

      <ng-template #detail>
        <z-popover>
          <div class="space-y-2 min-w-64">
            <p class="font-semibold text-sm">Audit log detail</p>
            <dl class="grid gap-1 text-xs text-muted-foreground">
              <div class="flex justify-between gap-4">
                <dt class="uppercase tracking-widest">Admin</dt>
                <dd>Casey</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="uppercase tracking-widest">Timestamp</dt>
                <dd>12m ago</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="uppercase tracking-widest">Source</dt>
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
        <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
          Event details
        </p>
        <h3 class="text-lg font-semibold">
          Click-triggered popovers work well for compact metadata
        </h3>
      </div>

      <ng-template #content>
        <z-popover>
          <div class="space-y-3 min-w-56">
            <div>
              <p class="font-semibold text-sm">Void Sessions Vol. 12</p>
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
        <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">Open state</p>
        <h3 class="text-lg font-semibold">Use zVisible to document the rendered panel itself</h3>
      </div>

      <ng-template #content>
        <z-popover>
          <div class="space-y-2 min-w-56">
            <p class="font-semibold text-sm">Theme settings</p>
            <p class="text-xs text-muted-foreground">
              This matches the dropdown-style content used in the theme switcher.
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
};

export default meta;
type Story = StoryObj;

export const AuditLogDetail: Story = {
  render: () => ({
    template: `<bt-story-popover-audit-log />`,
    moduleMetadata: { imports: [PopoverAuditLogStoryComponent] },
  }),
};

export const EventInfo: Story = {
  render: () => ({
    template: `<bt-story-popover-event-info />`,
    moduleMetadata: { imports: [PopoverEventInfoStoryComponent] },
  }),
};

export const OpenState: Story = {
  render: () => ({
    template: `<bt-story-popover-open-state />`,
    moduleMetadata: { imports: [PopoverOpenStateStoryComponent] },
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
