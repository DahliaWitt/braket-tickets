import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  ViewEncapsulation,
} from '@angular/core';

import type { ClassValue } from 'clsx';

import {
  alertVariants,
  alertDescriptionVariants,
  type ZardAlertTypeVariants,
  type ZardAlertAppearanceVariants,
} from './alert.variants';
import { mergeClasses } from '@ui/utils/merge-classes';
import { ZardIconComponent } from '@ui/components/primitives/icon/icon.component';
import type { ZardIcon } from '@ui/components/primitives/icon/icons';

const typeIconMap: Record<ZardAlertTypeVariants, ZardIcon> = {
  default: 'info',
  success: 'circle-check',
  warning: 'triangle-alert',
  error: 'circle-x',
  info: 'info',
};

@Component({
  selector: 'z-alert',
  imports: [ZardIconComponent],
  template: `
    @if (!hideIcon()) {
      <z-icon [zType]="iconName()" class="shrink-0 self-start text-base mt-0.5" aria-hidden="true" />
    }
    <div class="flex-1">
      @if (zTitle()) {
        <div data-alert-title [class]="titleClasses()">{{ zTitle() }}</div>
      }
      @if (zDescription()) {
        <div data-alert-description [class]="descriptionClasses()">{{ zDescription() }}</div>
      }
      <ng-content />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'classes()',
    '[attr.data-type]': 'zType()',
    '[attr.data-appearance]': 'zAppearance()',
    role: 'alert',
  },
  exportAs: 'zAlert',
})
export class ZardAlertComponent {
  readonly zType = input<ZardAlertTypeVariants>('default');
  readonly zAppearance = input<ZardAlertAppearanceVariants>('outline');
  readonly zTitle = input<string>('');
  readonly zDescription = input<string>('');
  readonly hideIcon = input(false);
  readonly class = input<ClassValue>('');

  protected readonly iconName = computed(() => typeIconMap[this.zType()]);

  protected readonly classes = computed(() =>
    mergeClasses(
      alertVariants({ zType: this.zType(), zAppearance: this.zAppearance() }),
      this.class(),
    ),
  );

  protected readonly titleClasses = computed(() => 'font-medium tracking-tight leading-none');

  protected readonly descriptionClasses = computed(() =>
    mergeClasses(
      alertDescriptionVariants({ zType: this.zType() }),
      this.zTitle() ? 'mt-1' : '',
    ),
  );
}
