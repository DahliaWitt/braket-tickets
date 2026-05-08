import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  input,
  viewChild,
} from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';

import { ZardSelectComponent } from './select.component';
import { ZardSelectItemComponent } from './select-item.component';

interface SelectItemOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const DEFAULT_ITEMS: readonly SelectItemOption[] = [
  { value: 'general', label: 'General Admission' },
  { value: 'vip', label: 'VIP Access' },
  { value: 'backstage', label: 'Backstage Pass' },
];

const DISABLED_ITEMS: readonly SelectItemOption[] = [
  { value: 'guest', label: 'Guest' },
  { value: 'artist guest', label: 'Artist Guest' },
  { value: 'staff', label: 'Staff', disabled: true },
];

const LONG_LABEL_ITEMS: readonly SelectItemOption[] = [
  { value: 'general', label: 'General Admission with Flexible Pricing and No Special Access' },
  { value: 'vip', label: 'VIP Access with Reserved Seating, Priority Entry, and Merch Bundle' },
  {
    value: 'artist guest',
    label: 'Artist Guest Pass for Backstage Access and Check-In Coordination',
  },
];

const COMPACT_ITEMS: readonly SelectItemOption[] = [
  { value: 'early', label: 'Early Entry' },
  { value: 'general', label: 'General Admission' },
  { value: 'vip', label: 'VIP Access' },
];

@Component({
  selector: 'storybook-select-item-shell',
  imports: [ZardSelectComponent, ZardSelectItemComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-3" [class]="widthClass()">
      <div class="space-y-1">
        <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
          {{ title() }}
        </p>
        <p class="text-xs text-muted-foreground font-sans">{{ description() }}</p>
      </div>

      <z-select #select class="w-full" [zValue]="selectedValue()" [zPlaceholder]="placeholder()">
        @for (item of items(); track item.value) {
          <z-select-item [zValue]="item.value" [zDisabled]="item.disabled ?? false">
            {{ item.label }}
          </z-select-item>
        }
      </z-select>
    </div>
  `,
})
class SelectItemStoryShell {
  readonly title = input('Select Item');
  readonly description = input('Option rows inside an open select menu.');
  readonly widthClass = input('w-80');
  readonly placeholder = input('Choose an option...');
  readonly selectedValue = input('vip');
  readonly items = input<readonly SelectItemOption[]>(DEFAULT_ITEMS);

  private readonly select = viewChild(ZardSelectComponent);

  constructor() {
    afterNextRender(() => {
      this.select()?.toggle();
    });
  }
}

const meta: Meta<ZardSelectItemComponent> = {
  title: 'Braket/Primitives/SelectItem',
  component: ZardSelectItemComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Select item is app-proven as the row primitive inside admin and ticketing selects. These stories keep the menu open so the option treatment is documented directly instead of only through the closed trigger.',
      },
    },
  },
  decorators: [
    (story) => ({
      ...story(),
      moduleMetadata: {
        imports: [SelectItemStoryShell],
      },
    }),
  ],
};

export default meta;
type Story = StoryObj<ZardSelectItemComponent>;

const renderSelectItemStory = ({
  title,
  description,
  widthClass,
  placeholder,
  selectedValue,
  items,
}: {
  title: string;
  description: string;
  widthClass: string;
  placeholder: string;
  selectedValue: string;
  items: readonly SelectItemOption[];
}): Story['render'] => {
  return () => ({
    props: {
      title,
      description,
      widthClass,
      placeholder,
      selectedValue,
      items,
    },
    template: `
      <storybook-select-item-shell
        [title]="title"
        [description]="description"
        [widthClass]="widthClass"
        [placeholder]="placeholder"
        [selectedValue]="selectedValue"
        [items]="items"
      />
    `,
  });
};

export const Default: Story = {
  render: renderSelectItemStory({
    title: 'Select Item',
    description: 'Option rows inside an open select menu.',
    widthClass: 'w-80',
    placeholder: 'Choose an option...',
    selectedValue: 'vip',
    items: DEFAULT_ITEMS,
  }),
  parameters: {
    docs: {
      description: {
        story: 'App-proven default option row inside a standard select menu.',
      },
    },
  },
};

export const DisabledItem: Story = {
  render: renderSelectItemStory({
    title: 'Disabled option',
    description: 'The item stays visible but cannot be selected.',
    widthClass: 'w-80',
    placeholder: 'Choose an option...',
    selectedValue: 'guest',
    items: DISABLED_ITEMS,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven disabled option treatment for choices that should remain visible but not selectable.',
      },
    },
  },
};

export const LongLabels: Story = {
  render: renderSelectItemStory({
    title: 'Long labels',
    description: 'The item label truncation mirrors long admin option lists.',
    widthClass: 'w-72',
    placeholder: 'Choose an option...',
    selectedValue: 'artist guest',
    items: LONG_LABEL_ITEMS,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven long-label stress case reflecting the option copy used in admin-facing forms.',
      },
    },
  },
};

export const CompactMode: Story = {
  render: renderSelectItemStory({
    title: 'Compact mode',
    description: 'Narrow triggers force the compact item treatment used in small sidebars.',
    widthClass: 'w-24',
    placeholder: 'Choose an option...',
    selectedValue: 'early',
    items: COMPACT_ITEMS,
  }),
  parameters: {
    docs: {
      description: {
        story: 'Reference compact treatment for especially narrow triggers or side panels.',
      },
    },
  },
};
