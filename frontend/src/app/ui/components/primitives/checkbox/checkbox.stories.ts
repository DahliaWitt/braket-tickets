import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  QueryList,
  ViewChildren,
} from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';
import { argsToTemplate } from '@storybook/angular';

import { ZardCheckboxComponent } from './checkbox.component';

@Component({
  selector: 'bt-story-checkbox-export-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardCheckboxComponent],
  template: `
    <div class="space-y-4 rounded-xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
          Event export
        </p>
        <h3 class="text-lg font-semibold">Select fields for the attendee export</h3>
        <p class="text-sm text-muted-foreground">
          Matches the export dialog Braket uses in event management.
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <z-checkbox>First name</z-checkbox>
        <z-checkbox>Email address</z-checkbox>
        <z-checkbox>Ticket tier</z-checkbox>
        <z-checkbox>Order total</z-checkbox>
        <z-checkbox>Check-in status</z-checkbox>
        <z-checkbox>Refund status</z-checkbox>
      </div>

      <z-checkbox class="mt-2">
        <span class="flex items-center gap-2">
          Include refunded tickets
          <span class="text-xs text-muted-foreground">(adds status columns)</span>
        </span>
      </z-checkbox>
    </div>
  `,
})
class CheckboxExportFieldsStoryComponent implements AfterViewInit {
  @ViewChildren(ZardCheckboxComponent)
  private readonly checkboxRefs!: QueryList<ZardCheckboxComponent>;

  ngAfterViewInit(): void {
    const selectedIndexes = new Set([0, 1, 2, 4, 6]);
    this.checkboxRefs.forEach((checkbox, index) => checkbox.writeValue(selectedIndexes.has(index)));
  }
}

@Component({
  selector: 'bt-story-checkbox-consent',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardCheckboxComponent],
  template: `
    <div class="space-y-4 rounded-xl border border-border bg-card p-6">
      <div class="space-y-1">
        <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
          Consent and cancellation
        </p>
        <h3 class="text-lg font-semibold">Use checkbox styles for high-stakes confirmation</h3>
        <p class="text-sm text-muted-foreground">
          We use regular checkboxes for form consent and destructive confirmations when the user is
          acknowledging a one-way action.
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <z-checkbox>I agree to the community vetting rules</z-checkbox>
        <z-checkbox zType="destructive">I confirm I want to cancel my reservation</z-checkbox>
      </div>

      <z-checkbox [disabled]="true">Feature unavailable while sales are paused</z-checkbox>
    </div>
  `,
})
class CheckboxConsentStoryComponent {}

const meta: Meta<ZardCheckboxComponent> = {
  title: 'Braket/Primitives/Checkbox',
  component: ZardCheckboxComponent,
  tags: ['autodocs'],
  argTypes: {
    zType: {
      control: 'select',
      options: ['default', 'destructive'],
    },
    zSize: {
      control: 'select',
      options: ['default', 'lg'],
    },
    zShape: {
      control: 'select',
      options: ['default', 'circle', 'square'],
    },
    disabled: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<z-checkbox ${argsToTemplate(args)}>I agree to the terms of the export</z-checkbox>`,
  }),
};

export default meta;
type Story = StoryObj<ZardCheckboxComponent>;

export const ExportFields: Story = {
  render: () => ({
    template: `<bt-story-checkbox-export-fields />`,
    moduleMetadata: { imports: [CheckboxExportFieldsStoryComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Represents the attendee export flow in event management, where checkboxes control which fields are included.',
      },
    },
  },
};

export const ConsentAndCancellation: Story = {
  render: () => ({
    template: `<bt-story-checkbox-consent />`,
    moduleMetadata: { imports: [CheckboxConsentStoryComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Shows how Braket uses checkbox styling for standard consent and destructive acknowledgement flows.',
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
  render: (args) => ({
    props: args,
    template: `<z-checkbox [disabled]="disabled">Feature unavailable while sales are paused</z-checkbox>`,
  }),
};
