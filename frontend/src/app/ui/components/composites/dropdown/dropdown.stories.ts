import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
} from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';

import { BraDropdownDirective } from './dropdown-trigger.directive';
import { BraDropdownMenuContentComponent } from './dropdown-menu-content.component';
import { BraDropdownMenuItemComponent } from './dropdown-item.component';
import { ZardButtonComponent } from '@ui/components/primitives/button/button.component';
import { ZardIconComponent } from '@ui/components/primitives/icon/icon.component';
import { ThemeToggleComponent } from '@ui/components/primitives/theme-toggle/theme-toggle.component';

// ---------------------------------------------------------------------------
// App-proven dropdown usage
// ---------------------------------------------------------------------------

@Component({
  selector: 'bt-story-dropdown-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ThemeToggleComponent],
  template: `
    <div class="space-y-3 rounded-xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
          App-proven usage
        </p>
        <h3 class="text-lg font-semibold">Theme toggle dropdown from the app header</h3>
        <p class="text-sm text-muted-foreground">
          The real header uses this dropdown to switch between light, dark, and system themes.
        </p>
      </div>

      <app-theme-toggle #themeToggleHost />
    </div>
  `,
})
class DropdownThemeToggleComponent implements AfterViewInit {
  @ViewChild('themeToggleHost', { read: ElementRef })
  private readonly themeToggleHost?: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      this.themeToggleHost?.nativeElement.querySelector('button')?.click();
    });
  }
}

// ---------------------------------------------------------------------------
// Library reference: action menu pattern
// ---------------------------------------------------------------------------

@Component({
  selector: 'bt-story-dropdown-reference-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ZardButtonComponent,
    BraDropdownDirective,
    BraDropdownMenuContentComponent,
    BraDropdownMenuItemComponent,
    ZardIconComponent,
  ],
  template: `
    <bra-dropdown-menu-content #menu>
      <bra-dropdown-menu-item>
        <z-icon zType="pencil" />
        Edit Event
      </bra-dropdown-menu-item>
      <bra-dropdown-menu-item>
        <z-icon zType="copy" />
        Duplicate
      </bra-dropdown-menu-item>
      <bra-dropdown-menu-item variant="destructive">
        <z-icon zType="trash" />
        Delete Event
      </bra-dropdown-menu-item>
    </bra-dropdown-menu-content>

    <button z-button zType="ghost" bra-dropdown [braDropdownMenu]="menu">
      Actions
      <z-icon zType="chevron-down" />
    </button>
  `,
})
class DropdownReferenceActionsComponent {}

// ---------------------------------------------------------------------------
// Library reference: hover trigger pattern
// ---------------------------------------------------------------------------

@Component({
  selector: 'bt-story-dropdown-reference-hover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ZardButtonComponent,
    BraDropdownDirective,
    BraDropdownMenuContentComponent,
    BraDropdownMenuItemComponent,
  ],
  template: `
    <bra-dropdown-menu-content #menu>
      <bra-dropdown-menu-item>Upcoming Events</bra-dropdown-menu-item>
      <bra-dropdown-menu-item>Past Events</bra-dropdown-menu-item>
      <bra-dropdown-menu-item>Saved Events</bra-dropdown-menu-item>
    </bra-dropdown-menu-content>

    <button z-button zType="ghost" bra-dropdown [braDropdownMenu]="menu" zTrigger="hover">
      Events
    </button>
  `,
})
class DropdownReferenceHoverComponent {}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta = {
  title: 'Braket/Composites/Dropdown',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: () => ({
    template: `<bt-story-dropdown-theme-toggle />`,
    moduleMetadata: { imports: [DropdownThemeToggleComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven dropdown usage from the header theme toggle. This story imports the real ThemeToggleComponent instead of rebuilding a fake menu.',
      },
    },
  },
};

export const ReferenceActionsMenu: Story = {
  render: () => ({
    template: `<bt-story-dropdown-reference-actions />`,
    moduleMetadata: { imports: [DropdownReferenceActionsComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference only: a generic action menu pattern with destructive and disabled states. The app does not currently use this exact composition.',
      },
    },
  },
};

export const ReferenceHoverTrigger: Story = {
  render: () => ({
    template: `<bt-story-dropdown-reference-hover />`,
    moduleMetadata: { imports: [DropdownReferenceHoverComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference only: hover-triggered dropdowns are supported by the primitives, but this is not an app-proven pattern.',
      },
    },
  },
};
