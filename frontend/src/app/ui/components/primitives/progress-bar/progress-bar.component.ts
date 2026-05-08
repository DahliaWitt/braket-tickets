import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  ViewEncapsulation,
} from '@angular/core';

import type { ClassValue } from 'clsx';

import {
  containerProgressBarVariants,
  progressBarVariants,
  type ZardProgressBarShapeVariants,
  type ZardProgressBarSizeVariants,
  type ZardProgressBarTypeVariants,
} from './progress-bar.variants';

import { mergeClasses } from '@ui/utils/merge-classes';

@Component({
  selector: 'z-progress-bar',
  template: `
    @if (zIndeterminate()) {
      <div
        [class]="classes()"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-label]="zAriaLabel() || 'Loading progress'"
        aria-busy="true"
      >
        <div [class]="barClasses()"></div>
      </div>
    } @else {
      <div
        [class]="classes()"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        [attr.aria-valuenow]="correctedProgress()"
        [attr.aria-label]="zAriaLabel() || 'Progress: ' + correctedProgress() + '%'"
      >
        <div [style.width.%]="correctedProgress()" [class]="barClasses()" id="bar"></div>
      </div>
    }
  `,
  styles: `
    @keyframes indeterminate {
      0% {
        left: -0%;
        width: 30%;
      }
      50% {
        left: 50%;
        width: 30%;
      }
      100% {
        left: 100%;
        width: 0;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'w-full',
  },
})
export class ZardProgressBarComponent {
  readonly zType = input<ZardProgressBarTypeVariants>('default');
  readonly zSize = input<ZardProgressBarSizeVariants>('default');
  readonly zShape = input<ZardProgressBarShapeVariants>('default');
  readonly zIndeterminate = input(false, { transform: booleanAttribute });
  readonly zAriaLabel = input<string>('');
  readonly class = input<ClassValue>('');
  readonly barClass = input<ClassValue>('');
  readonly progress = input(0);

  readonly correctedProgress = computed(() => {
    if (this.progress() > 100) {
      return 100;
    } else if (this.progress() < 0) {
      return 0;
    }
    return this.progress();
  });

  protected readonly classes = computed(() =>
    mergeClasses(
      containerProgressBarVariants({
        zIndeterminate: this.zIndeterminate(),
        zType: this.zType(),
        zSize: this.zSize(),
        zShape: this.zShape(),
      }),
      this.class(),
    ),
  );

  protected readonly barClasses = computed(() =>
    mergeClasses(
      progressBarVariants({
        zIndeterminate: this.zIndeterminate(),
        zType: this.zType(),
        zShape: this.zShape(),
      }),
      this.barClass(),
    ),
  );
}
