import type { Meta, StoryObj } from '@storybook/angular';

import {
  ZardFormFieldComponent,
  ZardFormLabelComponent,
  ZardFormMessageComponent,
} from './form-field.component';
import { ZardInputDirective } from '@ui/components/primitives/input/input.directive';

const meta: Meta<ZardFormFieldComponent> = {
  title: 'Braket/Primitives/FormField',
  component: ZardFormFieldComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Library-level primitive. Current app usage is limited, so this story documents the canonical form-field wrapper API.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<ZardFormFieldComponent>;

export const Default: Story = {
  render: () => ({
    template: `
      <z-form-field class="max-w-sm">
        <label z-form-label for="email">Email</label>
        <input id="email" zInput type="email" placeholder="user@example.com" />
        <z-form-message>We'll use this for account notifications.</z-form-message>
      </z-form-field>
    `,
    moduleMetadata: {
      imports: [
        ZardFormFieldComponent,
        ZardFormLabelComponent,
        ZardFormMessageComponent,
        ZardInputDirective,
      ],
    },
  }),
};

export const Required: Story = {
  render: () => ({
    template: `
      <z-form-field class="max-w-sm">
        <label z-form-label for="name" [zRequired]="true">Name</label>
        <input id="name" zInput type="text" placeholder="Your name" />
      </z-form-field>
    `,
    moduleMetadata: {
      imports: [ZardFormFieldComponent, ZardFormLabelComponent, ZardInputDirective],
    },
  }),
};

export const WithError: Story = {
  render: () => ({
    template: `
      <z-form-field class="max-w-sm">
        <label z-form-label for="password" [zRequired]="true">Password</label>
        <input id="password" zInput type="password" zStatus="error" />
        <z-form-message zType="error">Password must be at least 8 characters</z-form-message>
      </z-form-field>
    `,
    moduleMetadata: {
      imports: [
        ZardFormFieldComponent,
        ZardFormLabelComponent,
        ZardFormMessageComponent,
        ZardInputDirective,
      ],
    },
  }),
};

export const WithSuccess: Story = {
  render: () => ({
    template: `
      <z-form-field class="max-w-sm">
        <label z-form-label for="display-name">Display name</label>
        <input id="display-name" zInput type="text" value="Dahlia" zStatus="success" />
        <z-form-message zType="success">Display name looks good</z-form-message>
      </z-form-field>
    `,
    moduleMetadata: {
      imports: [
        ZardFormFieldComponent,
        ZardFormLabelComponent,
        ZardFormMessageComponent,
        ZardInputDirective,
      ],
    },
  }),
};
