import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
} from '@angular/core';
import type {Meta, StoryObj} from '@storybook/angular';

import {ThemeToggleComponent} from './theme-toggle.component';

@Component({
  selector: 'bt-story-theme-toggle-open',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ThemeToggleComponent],
  template: `
    <div class="space-y-3 rounded-xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p
          class="font-mono text-2xs tracking-widest text-muted-foreground uppercase"
        >
          Open menu state
        </p>
        <h3 class="text-lg font-semibold">
          Theme toggle with the dropdown expanded
        </h3>
        <p class="text-sm text-muted-foreground">
          The component reads the current theme from BraDarkMode and exposes
          Light, Dark, and System choices.
        </p>
      </div>

      <app-theme-toggle #themeToggleHost />
    </div>
  `,
})
class ThemeToggleOpenStoryComponent implements AfterViewInit {
  @ViewChild('themeToggleHost', {read: ElementRef})
  private readonly themeToggleHost?: ElementRef<HTMLElement>;

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      this.themeToggleHost?.nativeElement.querySelector('button')?.click();
    });
  }
}

const meta: Meta<ThemeToggleComponent> = {
  title: 'Braket/Primitives/ThemeToggle',
  component: ThemeToggleComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'App-proven theme menu used in the product shell to switch between light, dark, and system modes.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<ThemeToggleComponent>;

export const Default: Story = {};
Default.parameters = {
  docs: {
    description: {
      story: 'App-proven collapsed theme toggle state used in the app header.',
    },
  },
};

export const OpenMenu: Story = {
  render: () => ({
    template: `<bt-story-theme-toggle-open />`,
    moduleMetadata: {imports: [ThemeToggleOpenStoryComponent]},
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Documents the expanded dropdown so consumers can see the actual menu layout and selection affordance.',
      },
    },
  },
};
