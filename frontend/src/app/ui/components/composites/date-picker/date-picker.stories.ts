import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import {
  FormField,
  form,
  required,
  type MaybeFieldTree,
} from '@angular/forms/signals';
import type {Meta, StoryObj} from '@storybook/angular';

import {BraDatePickerComponent} from './date-picker.component';

interface DatePickerStoryState {
  date: Date | null;
  saleEndDate: Date | null;
  submitted: boolean;
  showSaleDeadline: boolean;
}

const datePickerStoryState: DatePickerStoryState = {
  date: null,
  saleEndDate: null,
  submitted: false,
  showSaleDeadline: false,
};

@Component({
  selector: 'bt-story-date-picker-event-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BraDatePickerComponent, FormField],
  template: `
    <div class="max-w-sm rounded-md border border-border bg-card p-6">
      <h2 class="mb-1 font-display text-lg font-bold">Event Editor</h2>
      <p class="mb-6 text-sm text-muted-foreground">
        Mirrors the compact scheduling field used in the admin event editor.
      </p>

      <div class="flex flex-col gap-6">
        <div class="space-y-2">
          <span
            class="block font-mono text-xs tracking-wider text-muted-foreground uppercase"
          >
            Date *
          </span>
          <bra-date-picker
            [formField]="eventForm.date"
            placeholder="Pick a date"
            zFormat="yyyy-MM-dd"
            zSize="sm"
            class="rounded-sm! border! border-b-0! border-border! bg-background! py-2! font-sans! text-sm!"
            [class.border-destructive/50!]="isFieldInvalid(eventForm.date)"
            [class.text-destructive-text!]="isFieldInvalid(eventForm.date)"
          />
          @if (isFieldInvalid(eventForm.date)) {
            <p class="text-xs text-destructive-text uppercase">
              Date is required
            </p>
          }
        </div>

        @if (showSaleDeadline()) {
          <div class="space-y-2">
            <span
              class="block font-mono text-xs tracking-wider text-muted-foreground uppercase"
            >
              Sale End Date
            </span>
            <bra-date-picker
              [formField]="eventForm.saleEndDate"
              placeholder="Ticket sale deadline"
              zFormat="yyyy-MM-dd"
              zSize="sm"
              class="rounded-sm! border! border-b-0! border-border! bg-background! py-2! font-sans! text-sm!"
            />
            <p class="text-xs text-muted-foreground">
              Optional cutoff used when scheduling ticket sales.
            </p>
          </div>
        }
      </div>
    </div>
  `,
})
class DatePickerEventEditorStoryComponent {
  readonly eventModel = signal({
    date: datePickerStoryState.date,
    saleEndDate: datePickerStoryState.saleEndDate,
  });

  readonly submitted = signal(datePickerStoryState.submitted);
  readonly showSaleDeadline = signal(datePickerStoryState.showSaleDeadline);

  readonly eventForm = form(this.eventModel, (f) => ({
    date: required(f.date),
    saleEndDate: f.saleEndDate,
  }));

  isFieldInvalid<T>(field: MaybeFieldTree<T>): boolean {
    if (typeof field !== 'function') return false;
    const state = field();
    return (state.touched() || this.submitted()) && state.invalid();
  }
}

function setDatePickerStoryState(state: Partial<DatePickerStoryState>): void {
  datePickerStoryState.date = state.date ?? null;
  datePickerStoryState.saleEndDate = state.saleEndDate ?? null;
  datePickerStoryState.submitted = state.submitted ?? false;
  datePickerStoryState.showSaleDeadline = state.showSaleDeadline ?? false;
}

function coerceStoryDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

const meta: Meta<BraDatePickerComponent> = {
  title: 'Braket/Composites/DatePicker',
  component: BraDatePickerComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Event-editor-focused date picker stories. These mirror the compact admin form treatment Braket actually uses, including the small size, YYYY-MM-DD formatting, and validation styling.',
      },
    },
  },
  argTypes: {
    zType: {
      control: 'select',
      options: ['default', 'outline', 'ghost'],
      description: 'Button treatment used for the date-picker trigger.',
    },
    zSize: {
      control: 'select',
      options: ['sm', 'default', 'lg'],
      description: 'Trigger sizing used by the surrounding form layout.',
    },
    placeholder: {
      control: 'text',
      description: 'Text shown before a date has been selected.',
    },
    zFormat: {
      control: 'text',
      description: 'Angular DatePipe format used for the selected date label.',
    },
    value: {
      control: 'date',
      description: 'Selected date shown in the trigger label.',
    },
    minDate: {
      control: 'date',
      description: 'Earliest selectable date in the calendar popover.',
    },
    maxDate: {
      control: 'date',
      description: 'Latest selectable date in the calendar popover.',
    },
    clearable: {
      control: 'boolean',
      description:
        'Opt-in clear affordance for optional dates. Leave off for required fields.',
    },
    clearLabel: {
      control: 'text',
      description: 'Accessible label announced for the clear button.',
    },
  },
  args: {
    zType: 'outline',
    zSize: 'default',
    placeholder: 'Pick a date',
    zFormat: 'MMMM d, yyyy',
    value: null,
    minDate: null,
    maxDate: null,
    clearable: false,
    clearLabel: 'clear date',
  },
  render: (args) => ({
    props: {
      ...args,
      value: coerceStoryDate(args.value),
      minDate: coerceStoryDate(args.minDate),
      maxDate: coerceStoryDate(args.maxDate),
    },
    template: `
      <div class="w-80">
        <bra-date-picker
          [zType]="zType"
          [zSize]="zSize"
          [placeholder]="placeholder"
          [zFormat]="zFormat"
          [value]="value"
          [minDate]="minDate"
          [maxDate]="maxDate"
          [clearable]="clearable"
          [clearLabel]="clearLabel"
        />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<BraDatePickerComponent>;

function renderEventEditorState(state: Partial<DatePickerStoryState>) {
  setDatePickerStoryState(state);
  return {
    template: `<bt-story-date-picker-event-editor />`,
    moduleMetadata: {
      imports: [DatePickerEventEditorStoryComponent],
    },
  };
}

export const EventEditorField: Story = {
  render: () =>
    renderEventEditorState({
      date: null,
      submitted: false,
    }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven empty event-editor date field before validation has run.',
      },
    },
  },
};

export const PrepopulatedEventDate: Story = {
  render: () =>
    renderEventEditorState({
      date: new Date('2026-06-20T00:00:00.000Z'),
      submitted: false,
    }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven event-editor date field after an existing event date is loaded.',
      },
    },
  },
};

export const RequiredValidationState: Story = {
  render: () =>
    renderEventEditorState({
      date: null,
      submitted: true,
    }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven required-field validation state for event scheduling.',
      },
    },
  },
};

export const ClearableOptionalDate: Story = {
  args: {
    zSize: 'sm',
    zFormat: 'yyyy-MM-dd',
    placeholder: 'Same night (optional)',
    value: new Date('2026-06-21T00:00:00.000Z'),
    clearable: true,
    clearLabel: 'clear end date',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Optional-date treatment used for the event end date: a populated clearable picker shows an accessible clear button that empties the value.',
      },
    },
  },
};

export const EventSchedulingWindow: Story = {
  render: () =>
    renderEventEditorState({
      date: new Date('2026-06-20T00:00:00.000Z'),
      saleEndDate: new Date('2026-06-18T00:00:00.000Z'),
      submitted: false,
      showSaleDeadline: true,
    }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven editor state for configuring both the event date and ticket-sale cutoff.',
      },
    },
  },
};
