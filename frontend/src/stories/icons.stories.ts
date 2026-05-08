import { Meta, StoryObj } from '@storybook/angular';
import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { ZardIconComponent } from '../app/ui/components/primitives/icon/icon.component';
import { ZARD_ICONS } from '../app/ui/components/primitives/icon/icons';

@Component({
  selector: 'bt-story-icon-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardIconComponent],
  template: `
    <div class="grid grid-cols-4 gap-4 sm:grid-cols-6 md:grid-cols-8">
      @for (name of iconNames(); track name) {
        <div class="flex flex-col items-center gap-2 rounded-md bg-muted/30 p-3 transition-colors hover:bg-muted/60">
          <z-icon [zType]="name" zSize="default" />
          <span class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">{{ name }}</span>
        </div>
      }
    </div>
  `,
})
class IconGalleryComponent {
  iconNames = computed(() => (Object.keys(ZARD_ICONS).toSorted() as (keyof typeof ZARD_ICONS)[]));
}

const meta: Meta<IconGalleryComponent> = {
  title: 'Design System/Icons',
  component: IconGalleryComponent,
};

export default meta;
type Story = StoryObj<IconGalleryComponent>;

export const Gallery: Story = {};
