import {DatePipe} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
  ViewEncapsulation,
  type TemplateRef,
} from '@angular/core';
import {NG_VALUE_ACCESSOR, type ControlValueAccessor} from '@angular/forms';

import type {ClassValue} from 'clsx';

import {ControlValueAccessorBase} from '@ui/utils/control-value-accessor.base';

import {
  datePickerVariants,
  type BraDatePickerVariants,
} from './date-picker.variants';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {BraCalendarComponent} from '@ui/components/composites/calendar/calendar.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';
import {
  ZardPopoverComponent,
  ZardPopoverDirective,
} from '@ui/components/primitives/popover/popover.component';

import {mergeClasses} from '@ui/utils/merge-classes';

const HEIGHT_BY_SIZE: Record<
  NonNullable<BraDatePickerVariants['zSize']>,
  string
> = {
  sm: 'py-2 text-sm',
  default: 'py-4 text-xl md:text-2xl',
  lg: 'py-5 text-2xl md:text-3xl',
};

@Component({
  selector: 'bra-date-picker, [bra-date-picker]',
  imports: [
    ZardButtonComponent,
    BraCalendarComponent,
    ZardPopoverComponent,
    ZardPopoverDirective,
    ZardIconComponent,
  ],
  template: `
    <button
      z-button
      type="button"
      [zType]="zType() ?? 'outline'"
      [zSize]="zSize() ?? 'default'"
      [disabled]="disabled()"
      [class]="buttonClasses()"
      zPopover
      #popoverDirective="zPopover"
      [zContent]="calendarTemplate"
      [zVisible]="isOpen()"
      zTrigger="click"
      (zVisibleChange)="onPopoverVisibilityChange($event)"
      [attr.aria-expanded]="isOpen()"
      [attr.aria-haspopup]="true"
      [attr.aria-label]="ariaLabel()"
    >
      <z-icon zType="calendar" aria-hidden="true" />
      <span [class]="textClasses()">
        {{ displayText() }}
      </span>
    </button>

    <ng-template #calendarTemplate>
      <z-popover [class]="popoverClasses()">
        <bra-calendar
          #calendar
          class="border-0"
          [value]="value()"
          [minDate]="minDate()"
          [maxDate]="maxDate()"
          [disabled]="disabled()"
          (dateChange)="onDateChange($event)"
        />
      </z-popover>
    </ng-template>
  `,
  providers: [
    DatePipe,
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BraDatePickerComponent),
      multi: true,
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    '[class]': 'classes()',
  },
  exportAs: 'zDatePicker',
})
export class BraDatePickerComponent
  extends ControlValueAccessorBase<Date | null>
  implements ControlValueAccessor
{
  private readonly datePipe = inject(DatePipe);

  readonly calendarTemplate =
    viewChild.required<TemplateRef<unknown>>('calendarTemplate');
  readonly popoverDirective =
    viewChild.required<ZardPopoverDirective>('popoverDirective');
  readonly calendar = viewChild.required<BraCalendarComponent>('calendar');

  readonly class = input<ClassValue>('');
  readonly zType = input<BraDatePickerVariants['zType']>('outline');
  readonly zSize = input<BraDatePickerVariants['zSize']>('default');
  readonly value = model<Date | null>(null);
  readonly placeholder = input<string>('pick a date');
  readonly zFormat = input<string>('MMMM d, yyyy');
  readonly minDate = input<Date | null>(null);
  readonly maxDate = input<Date | null>(null);

  readonly dateChange = output<Date | null>();
  readonly isOpen = signal(false);

  protected readonly classes = computed(() =>
    mergeClasses(
      datePickerVariants({
        zSize: this.zSize(),
      }),
      this.class(),
    ),
  );

  protected readonly buttonClasses = computed(() => {
    const hasValue = !!this.value();
    const size: NonNullable<BraDatePickerVariants['zSize']> =
      this.zSize() ?? 'default';
    const height = HEIGHT_BY_SIZE[size];
    return mergeClasses(
      'w-full justify-between border-b-2 bg-transparent text-left font-mono transition-colors',
      'border-input text-foreground hover:border-ring focus-visible:border-ring focus-visible:outline-none',
      !hasValue && 'text-muted-foreground',
      height,
      this.class(),
    );
  });

  protected readonly textClasses = computed(() => {
    const hasValue = !!this.value();
    return mergeClasses(!hasValue && 'text-muted-foreground');
  });

  protected readonly popoverClasses = computed(() =>
    mergeClasses('w-auto p-0'),
  );

  protected readonly displayText = computed(() => {
    const date = this.value();
    if (!date) {
      return this.placeholder();
    }
    return this.formatDate(date, this.zFormat());
  });

  protected readonly ariaLabel = computed(() => {
    const date = this.value();
    if (!date) {
      return this.placeholder();
    }
    return `Selected date ${this.formatDate(date, this.zFormat())}`;
  });

  protected onDateChange(date: Date | Date[]): void {
    // Date picker always uses single mode, so we can safely cast
    const singleDate = Array.isArray(date) ? (date[0] ?? null) : date;
    this.value.set(singleDate);
    this.onChange(singleDate);
    this.onTouched();
    this.dateChange.emit(singleDate);

    this.popoverDirective().hide();
  }

  protected onPopoverVisibilityChange(visible: boolean): void {
    const wasOpen = this.isOpen();
    this.isOpen.set(visible);

    if (visible && !wasOpen) {
      setTimeout(() => {
        if (this.calendar()) {
          this.calendar().resetNavigation();
        }
      });
    }
  }

  private formatDate(date: Date, format: string): string {
    return this.datePipe.transform(date, format) ?? '';
  }

  writeValue(value: Date | null): void {
    this.value.set(value);
  }
}
