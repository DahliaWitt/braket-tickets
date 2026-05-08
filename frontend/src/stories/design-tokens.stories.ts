import { Meta, StoryObj } from '@storybook/angular';
import { ChangeDetectionStrategy, Component, signal, afterNextRender, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';

interface TokenGroup {
  label: string;
  tokens: { name: string; variable: string; value: string }[];
}

@Component({
  selector: 'bt-story-color-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (group of groups(); track group.label) {
      <div class="mb-8">
        <h3 class="font-display text-lg font-bold mb-4">{{ group.label }}</h3>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          @for (token of group.tokens; track token.name) {
            <div class="flex flex-col gap-2">
              <div
                class="h-16 w-full rounded-md border border-border"
                [style.background-color]="'hsl(' + token.value + ')'"
              ></div>
              <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
                {{ token.name }}
              </span>
              <span class="font-mono text-2xs text-muted-foreground/60">
                {{ token.variable }}
              </span>
            </div>
          }
        </div>
      </div>
    }
  `,
})
class ColorPaletteComponent {
  private readonly doc = inject(DOCUMENT);
  groups = signal<TokenGroup[]>([]);

  private readonly TOKEN_MAP: { label: string; tokens: { name: string; variable: string }[] }[] = [
    {
      label: 'Brand',
      tokens: [
        { name: 'Deep Plum', variable: '--primary' },
        { name: 'Violet', variable: '--secondary' },
        { name: 'Burnt Amber', variable: '--accent' },
        { name: 'Background', variable: '--background' },
      ],
    },
    {
      label: 'Semantic',
      tokens: [
        { name: 'Foreground', variable: '--foreground' },
        { name: 'Muted', variable: '--muted' },
        { name: 'Muted Foreground', variable: '--muted-foreground' },
        { name: 'Border', variable: '--border' },
        { name: 'Ring', variable: '--ring' },
        { name: 'Destructive', variable: '--destructive' },
        { name: 'Accent', variable: '--accent' },
        { name: 'Card', variable: '--card' },
        { name: 'Popover', variable: '--popover' },
      ],
    },
  ];

  constructor() {
    afterNextRender(() => {
      const styles = getComputedStyle(this.doc.documentElement);
      this.groups.set(
        this.TOKEN_MAP.map((group) => ({
          label: group.label,
          tokens: group.tokens.map((t) => ({
            ...t,
            value: styles.getPropertyValue(t.variable).trim(),
          })),
        })),
      );
    });
  }
}

const meta: Meta<ColorPaletteComponent> = {
  title: 'Design System/Colors',
  component: ColorPaletteComponent,
};

export default meta;
type Story = StoryObj<ColorPaletteComponent>;

export const Palette: Story = {};
