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
  formFieldVariants,
  formLabelVariants,
  formMessageVariants,
  type ZardFormMessageTypeVariants,
} from './form-field.variants';
import { mergeClasses } from '@ui/utils/merge-classes';

@Component({
  selector: 'z-form-field, [z-form-field]',
  template: '<ng-content />',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'classes()' },
  exportAs: 'zFormField',
})
export class ZardFormFieldComponent {
  readonly class = input<ClassValue>('');
  protected readonly classes = computed(() => mergeClasses(formFieldVariants(), this.class()));
}

@Component({
  selector: 'z-form-label, label[z-form-label]',
  template: '<ng-content />',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'classes()', '[attr.data-required]': 'zRequired() || null' },
  exportAs: 'zFormLabel',
})
export class ZardFormLabelComponent {
  readonly class = input<ClassValue>('');
  readonly zRequired = input(false, { transform: booleanAttribute });
  protected readonly classes = computed(() =>
    mergeClasses(formLabelVariants({ zRequired: this.zRequired() }), this.class()),
  );
}

@Component({
  selector: 'z-form-message, [z-form-message]',
  template: '<ng-content />',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { '[class]': 'classes()', '[attr.data-type]': 'zType()' },
  exportAs: 'zFormMessage',
})
export class ZardFormMessageComponent {
  readonly class = input<ClassValue>('');
  readonly zType = input<ZardFormMessageTypeVariants>('default');
  protected readonly classes = computed(() =>
    mergeClasses(formMessageVariants({ zType: this.zType() }), this.class()),
  );
}
