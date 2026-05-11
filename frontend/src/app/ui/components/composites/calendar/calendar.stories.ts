import type {Meta, StoryObj} from '@storybook/angular';

import {BraCalendarComponent} from './calendar.component';

type CalendarStoryValue = Date | Date[] | null;

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

function coerceStoryValue(value: unknown): CalendarStoryValue {
  if (Array.isArray(value)) {
    return value
      .map(coerceStoryDate)
      .filter((date): date is Date => date !== null);
  }

  return coerceStoryDate(value);
}

const meta: Meta<BraCalendarComponent> = {
  title: 'Braket/Composites/Calendar',
  component: BraCalendarComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Calendar is primarily consumed through the date-picker in the app. These stories document the single-date foundation that powers that flow, while keeping multiple and range selection available as library-reference modes.',
      },
    },
  },
  argTypes: {
    zMode: {
      control: 'select',
      options: ['single', 'multiple', 'range'],
      description: 'Selection mode used by the calendar grid.',
    },
    value: {
      control: 'object',
      description:
        'Selected date value. Use a Date for single mode or a Date array for range and multiple modes.',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables date navigation and selection.',
    },
    minDate: {
      control: 'date',
      description: 'Earliest selectable date.',
    },
    maxDate: {
      control: 'date',
      description: 'Latest selectable date.',
    },
  },
  render: (args) => ({
    props: {
      ...args,
      value: coerceStoryValue(args.value),
      minDate: coerceStoryDate(args.minDate),
      maxDate: coerceStoryDate(args.maxDate),
    },
    template: `
      <div class="rounded-2xl border border-border bg-card p-4">
        <bra-calendar
          [zMode]="zMode"
          [value]="value"
          [disabled]="disabled"
          [minDate]="minDate"
          [maxDate]="maxDate"
        />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<BraCalendarComponent>;

export const Default: Story = {
  name: 'Date Picker Foundation',
  args: {
    zMode: 'single',
    value: new Date(2026, 5, 20),
    minDate: new Date(2026, 5, 1),
    maxDate: new Date(2026, 5, 30),
    disabled: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'The app usually reaches calendar through the date-picker. This story documents the single-date selection state that underpins event scheduling forms.',
      },
    },
  },
};

export const EmptySelection: Story = {
  args: {
    zMode: 'single',
    value: null,
    minDate: null,
    maxDate: null,
    disabled: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Reference story for the unselected state before a date is chosen.',
      },
    },
  },
};

export const EventSchedulingRangeReference: Story = {
  args: {
    zMode: 'range',
    value: [new Date(2026, 5, 20), new Date(2026, 5, 22)],
    minDate: new Date(2026, 5, 1),
    maxDate: new Date(2026, 5, 30),
    disabled: false,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for range selection. Useful when a feature needs a start/end scheduling surface, even though the current app usually wraps calendar through higher-level inputs.',
      },
    },
  },
};

export const MultipleSelectionReference: Story = {
  args: {
    zMode: 'multiple',
    value: [
      new Date(2026, 5, 10),
      new Date(2026, 5, 15),
      new Date(2026, 5, 22),
    ],
    minDate: null,
    maxDate: null,
    disabled: false,
  },
  parameters: {
    docs: {
      description: {
        story: 'Library reference for multi-date selection support.',
      },
    },
  },
};

export const DisabledWindowReference: Story = {
  args: {
    zMode: 'single',
    value: new Date(2026, 5, 20),
    minDate: new Date(2026, 5, 10),
    maxDate: new Date(2026, 5, 25),
    disabled: true,
  },
  parameters: {
    docs: {
      description: {
        story:
          'Reference state for disabled calendars and constrained date windows.',
      },
    },
  },
};
