import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormField, form, required, type MaybeFieldTree } from '@angular/forms/signals';
import type { Meta, StoryObj } from '@storybook/angular';

import { BraDatePickerComponent } from './date-picker.component';

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
      <h2 class="font-display text-lg font-bold mb-1">Event Editor</h2>
      <p class="text-sm text-muted-foreground mb-6">
        Mirrors the compact scheduling field used in the admin event editor.
      </p>

      <div class="flex flex-col gap-6">
        <div class="space-y-2">
          <span class="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Date *
          </span>
          <bra-date-picker
            [formField]="eventForm.date"
            placeholder="Pick a date"
            zFormat="yyyy-MM-dd"
            zSize="sm"
            class="!border-b-0 !border !border-border !bg-background !rounded-sm !py-2 !text-sm !font-sans"
            [class.!border-destructive/50]="isFieldInvalid(eventForm.date)"
            [class.!text-destructive]="isFieldInvalid(eventForm.date)"
          />
          @if (isFieldInvalid(eventForm.date)) {
            <p class="text-destructive text-xs uppercase">Date is required</p>
          }
        </div>

        @if (showSaleDeadline()) {
          <div class="space-y-2">
            <span class="block text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Sale End Date
            </span>
            <bra-date-picker
              [formField]="eventForm.saleEndDate"
              placeholder="Ticket sale deadline"
              zFormat="yyyy-MM-dd"
              zSize="sm"
              class="!border-b-0 !border !border-border !bg-background !rounded-sm !py-2 !text-sm !font-sans"
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
};

export const PrepopulatedEventDate: Story = {
  render: () =>
    renderEventEditorState({
      date: new Date('2026-06-20T00:00:00.000Z'),
      submitted: false,
    }),
};

export const RequiredValidationState: Story = {
  render: () =>
    renderEventEditorState({
      date: null,
      submitted: true,
    }),
};

export const EventSchedulingWindow: Story = {
  render: () =>
    renderEventEditorState({
      date: new Date('2026-06-20T00:00:00.000Z'),
      saleEndDate: new Date('2026-06-18T00:00:00.000Z'),
      submitted: false,
      showSaleDeadline: true,
    }),
};
