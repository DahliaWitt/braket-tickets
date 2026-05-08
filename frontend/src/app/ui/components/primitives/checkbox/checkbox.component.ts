import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  output,
  signal,
  ViewEncapsulation,
} from '@angular/core';
import {type ControlValueAccessor, NG_VALUE_ACCESSOR} from '@angular/forms';

import type {ClassValue} from 'clsx';

import {
  checkboxLabelVariants,
  checkboxVariants,
  type ZardCheckboxVariants,
} from './checkbox.variants';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

import {generateId, mergeClasses, transform} from '@ui/utils/merge-classes';

type OnTouchedType = () => void;
type OnChangeType = (value: boolean) => void;

@Component({
  selector: 'z-checkbox, [z-checkbox]',
  imports: [ZardIconComponent],
  template: `
    <label [id]="id + '-container'" [class]="containerClasses()">
      <main class="relative flex">
        <input
          #input
          type="checkbox"
          [id]="id"
          [class]="classes()"
          [checked]="checked()"
          [disabled]="isDisabled()"
          [attr.aria-describedby]="zAriaDescribedBy()"
          (change)="onCheckboxChange()"
          (blur)="onCheckboxBlur()"
          name="checkbox"
        />
        <z-icon
          zType="check"
          [class]="
            'pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-primary-foreground transition-opacity ' +
            (checked() ? 'opacity-100' : 'opacity-0')
          "
        />
      </main>
      <span [class]="labelClasses()">
        <ng-content />
      </span>
    </label>
  `,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ZardCheckboxComponent),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  exportAs: 'zCheckbox',
})
export class ZardCheckboxComponent implements ControlValueAccessor {
  readonly checkChange = output<boolean>();
  readonly class = input<ClassValue>('');
  readonly disabled = input(false, {transform});
  readonly zAriaDescribedBy = input<string | null>(null);
  readonly zType = input<ZardCheckboxVariants['zType']>('default');
  readonly zSize = input<ZardCheckboxVariants['zSize']>('default');
  readonly zShape = input<ZardCheckboxVariants['zShape']>('default');

  private onChange: OnChangeType = (_val: boolean) => {
    // No-op
  };
  private onTouched: OnTouchedType = () => {
    // No-op
  };
  private readonly formDisabled = signal(false);
  protected readonly isDisabled = computed(
    () => this.disabled() || this.formDisabled(),
  );

  protected readonly classes = computed(() =>
    mergeClasses(
      checkboxVariants({
        zType: this.zType(),
        zSize: this.zSize(),
        zShape: this.zShape(),
      }),
      this.class(),
    ),
  );

  protected readonly containerClasses = computed(
    () =>
      `flex items-center gap-2 min-h-[44px] min-w-[44px] ${
        this.isDisabled() ? 'cursor-not-allowed' : 'cursor-pointer'
      }`,
  );

  protected readonly labelClasses = computed(() =>
    mergeClasses(checkboxLabelVariants({zSize: this.zSize()})),
  );
  readonly checked = signal(false);
  protected readonly id = generateId('checkbox');

  writeValue(val: boolean): void {
    this.checked.set(val);
  }

  registerOnChange(fn: OnChangeType): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: OnTouchedType): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  onCheckboxBlur(): void {
    this.onTouched();
  }

  onCheckboxChange(): void {
    if (this.isDisabled()) {
      return;
    }

    const newValue = !this.checked();
    this.checked.set(newValue);
    this.onChange(newValue);
    this.checkChange.emit(newValue);
  }
}
