import {Meta, StoryObj} from '@storybook/angular';
import {ChangeDetectionStrategy, Component} from '@angular/core';
import {ZardBadgeComponent} from '../app/ui/components/primitives/badge/badge.component';
import {ZardButtonComponent} from '../app/ui/components/primitives/button/button.component';

@Component({
  selector: 'bt-story-brand-patterns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardBadgeComponent, ZardButtonComponent],
  template: `
    <!-- The Mono Signature -->
    <section class="mb-12">
      <h2 class="font-display text-2xl font-bold mb-6">The Mono Signature</h2>
      <p class="text-sm text-muted-foreground mb-4">
        The brand's DNA: <code>font-mono uppercase tracking-widest text-2xs</code>. This pattern
        appears on 400+ elements. It IS the brand.
      </p>
      <div class="flex flex-wrap gap-6 items-center">
        <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground"
          >Navigation Label</span
        >
        <span class="font-mono text-2xs uppercase tracking-widest text-primary">Active State</span>
        <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground/60"
          >Disabled Label</span
        >
        <z-badge>Status Badge</z-badge>
      </div>
    </section>

    <!-- Gradient Text -->
    <section class="mb-12">
      <h2 class="font-display text-2xl font-bold mb-6">Gradient Text</h2>
      <p class="text-sm text-muted-foreground mb-4">
        Plum → Violet gradient for emphasis. Use sparingly — headings and hero text only.
      </p>
      <h3
        class="font-display text-4xl font-bold bg-linear-to-r from-primary to-secondary bg-clip-text text-transparent"
      >
        Pulp
      </h3>
    </section>

    <!-- Accent Color -->
    <section class="mb-12">
      <h2 class="font-display text-2xl font-bold mb-6">Accent: Burnt Amber</h2>
      <p class="text-sm text-muted-foreground mb-4">
        Warm accent for highlights, emphasis, and secondary CTAs. Derived from the waterfall
        texture.
      </p>
      <div class="flex gap-6 items-center">
        <div class="rounded-sm border border-border p-6 bg-accent">
          <span class="font-mono text-2xs uppercase tracking-widest text-accent-foreground"
            >Amber Card</span
          >
        </div>
        <span class="font-mono text-2xs uppercase tracking-widest text-accent">Amber Label</span>
      </div>
    </section>

    <!-- Focus Ring -->
    <section class="mb-12">
      <h2 class="font-display text-2xl font-bold mb-6">Focus Rings</h2>
      <p class="text-sm text-muted-foreground mb-4">
        2px solid primary, 2px offset, box-shadow halo. Tab through to see it live.
      </p>
      <div class="flex gap-4">
        <button z-button>Tab to me</button>
        <button z-button zType="outline">And me</button>
      </div>
    </section>
  `,
})
class BrandPatternsComponent {}

const meta: Meta<BrandPatternsComponent> = {
  title: 'Design System/Brand Patterns',
  component: BrandPatternsComponent,
};

export default meta;
type Story = StoryObj<BrandPatternsComponent>;

export const Overview: Story = {};
