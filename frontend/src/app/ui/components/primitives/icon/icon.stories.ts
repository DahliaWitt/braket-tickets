import type { Meta, StoryObj } from '@storybook/angular';
import { argsToTemplate } from '@storybook/angular';

import { ZardAlertComponent } from '../alert/alert.component';
import { ZardBadgeComponent } from '../badge/badge.component';
import { ZardButtonComponent } from '../button/button.component';

import { ZardIconComponent } from './icon.component';

const meta: Meta<ZardIconComponent> = {
  title: 'Braket/Primitives/Icon',
  component: ZardIconComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Icon is app-proven as a supporting primitive inside buttons, alerts, badges, and navigation controls. These stories focus on those real compositions and use the gallery as a reference index for the shared icon set.',
      },
    },
  },
  argTypes: {
    zType: {
      control: 'select',
      options: [
        'plus',
        'check',
        'x',
        'triangle-alert',
        'info',
        'search',
        'bell',
        'calendar',
        'user',
        'users',
        'heart',
        'star',
        'zap',
        'shield',
        'settings',
        'log-out',
        'arrow-right',
        'arrow-left',
        'chevron-down',
        'chevron-up',
        'loader-circle',
        'trash',
        'pencil',
        'eye',
        'eye-off',
        'circle-check',
        'circle-x',
        'circle-alert',
        'map-pin',
        'tag',
        'download',
        'share-2',
        'key',
        'globe',
        'sparkles',
        'sun',
        'moon',
        'sun-moon',
        'wifi-off',
        'file-spreadsheet',
        'file-text',
        'clock',
        'menu',
        'link',
        'credit-card',
        'badge-check',
      ],
    },
    zSize: {
      control: 'select',
      options: ['sm', 'default', 'lg', 'xl'],
    },
    zStrokeWidth: { control: 'number' },
    zAbsoluteStrokeWidth: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<z-icon ${argsToTemplate(args)} />`,
  }),
};

export default meta;
type Story = StoryObj<ZardIconComponent>;

export const Default: Story = {
  args: { zType: 'plus', zSize: 'default' },
  parameters: {
    docs: {
      description: {
        story:
          'Reference playground for the raw icon API, size tokens, and available glyph selection.',
      },
    },
  },
};

export const IconButtons: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Button composition
          </p>
          <h3 class="text-lg font-semibold">Pair icons with labels, or make the label the aria name</h3>
        </div>

        <div class="flex flex-wrap gap-3">
          <button z-button zType="default">
            <z-icon zType="plus" />
            Add ticket type
          </button>
          <button z-button zType="outline">
            <z-icon zType="share-2" />
            Share event
          </button>
          <button z-button zType="ghost" zShape="circle" aria-label="Open settings">
            <z-icon zType="settings" />
          </button>
        </div>
      </div>
    `,
    moduleMetadata: { imports: [ZardButtonComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven composition for button labels, back links, and icon-only utility actions.',
      },
    },
  },
};

export const StatusIcons: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Status messaging
          </p>
          <h3 class="text-lg font-semibold">Icons support alerts and chips when the label carries the meaning</h3>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <z-alert
            zType="warning"
            zAppearance="soft"
            zTitle="Ticket Sales Paused"
            zDescription="We surface the warning state with a matching icon and concise copy."
          />

          <div class="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
            <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
              Event badge
            </p>
            <div class="flex flex-wrap gap-2">
              <z-badge zType="success" zShape="pill">
                <span class="inline-flex items-center gap-1.5">
                  <z-icon zType="circle-check" zSize="sm" />
                  Verified
                </span>
              </z-badge>
              <z-badge zType="outline" zShape="pill">
                <span class="inline-flex items-center gap-1.5">
                  <z-icon zType="map-pin" zSize="sm" />
                  Brooklyn
                </span>
              </z-badge>
            </div>
          </div>
        </div>
      </div>
    `,
    moduleMetadata: { imports: [ZardAlertComponent, ZardBadgeComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven status messaging pattern where the icon supports the text rather than replacing it.',
      },
    },
  },
};

export const AppIconGallery: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 rounded-xl border border-border bg-card p-6">
        <div class="space-y-1">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            App icon set
          </p>
          <h3 class="text-lg font-semibold">Common icons used across Braket</h3>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="calendar" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">calendar</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="map-pin" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">map-pin</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="download" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">download</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="loader-circle" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">loader-circle</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="circle-check" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">circle-check</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="circle-alert" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">circle-alert</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="chevron-down" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">chevron-down</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="arrow-left" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">arrow-left</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="file-spreadsheet" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">file-spreadsheet</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="file-text" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">file-text</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="wifi-off" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">wifi-off</span>
          </div>
          <div class="flex flex-col items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
            <z-icon zType="sun-moon" zSize="lg" />
            <span class="font-mono text-2xs text-muted-foreground">sun-moon</span>
          </div>
        </div>
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Reference gallery of the most common Braket glyphs used across product and admin surfaces.',
      },
    },
  },
};
