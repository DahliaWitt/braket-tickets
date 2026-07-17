import {DatePipe} from '@angular/common';
import {
  booleanAttribute,
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
  ElementRef,
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
    <!--
      The wrapper must be inline-level: the component host renders as
      display:inline, and a block-level child fragments the host's inline box
      (its border/padding classes then paint around an empty strip). An
      inline-block also gives the absolute clear affordance a reliable
      containing block, which an inline host does not.
    -->
    <span class="relative inline-block w-full">
      <button
        z-button
        type="button"
        #triggerButton
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
      @if (showClearButton()) {
        <button
          type="button"
          data-testid="date-picker-clear"
          class="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          [attr.aria-label]="clearLabel()"
          (click)="onClearClick()"
          (keydown.escape)="onClearEscape($event)"
        >
          <z-icon zType="x" aria-hidden="true" />
        </button>
      }
    </span>

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
  private readonly triggerButton = viewChild.required<
    unknown,
    ElementRef<HTMLButtonElement>
  >('triggerButton', {read: ElementRef});

  readonly class = input<ClassValue>('');
  readonly zType = input<BraDatePickerVariants['zType']>('outline');
  readonly zSize = input<BraDatePickerVariants['zSize']>('default');
  readonly value = model<Date | null>(null);
  readonly placeholder = input<string>('pick a date');
  readonly zFormat = input<string>('MMMM d, yyyy');
  readonly minDate = input<Date | null>(null);
  readonly maxDate = input<Date | null>(null);
  /**
   * Opt-in: renders a clear affordance when a date is selected. Leave off for
   * required fields so they cannot be emptied from the UI.
   */
  readonly clearable = input(false, {transform: booleanAttribute});
  readonly clearLabel = input<string>('clear date');

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

  protected readonly showClearButton = computed(
    () => this.clearable() && !!this.value() && !this.disabled(),
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
      // Reserve space for the overlaid clear affordance whenever it can
      // appear, so the text does not shift when a date is set or cleared.
      this.clearable() && 'pr-10',
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

  protected onClearClick(): void {
    this.value.set(null);
    this.onChange(null);
    this.onTouched();
    this.dateChange.emit(null);
    // The clear button removes itself from the DOM; without an explicit
    // handoff, keyboard/screen-reader focus falls back to <body>.
    this.triggerButton().nativeElement.focus();
  }

  protected onClearEscape(event: Event): void {
    if (!this.isOpen()) return;
    event.preventDefault();
    this.popoverDirective().hide();
    this.triggerButton().nativeElement.focus();
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
