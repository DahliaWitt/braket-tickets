import type {Meta, StoryObj} from '@storybook/angular';

import {
  ZardFormFieldComponent,
  ZardFormLabelComponent,
  ZardFormMessageComponent,
} from './form-field.component';
import {ZardInputDirective} from '@ui/components/primitives/input/input.directive';
import type {ZardFormMessageTypeVariants} from './form-field.variants';

type FormFieldStoryArgs = ZardFormFieldComponent & {
  zRequired: boolean;
  zType: ZardFormMessageTypeVariants;
};

const meta: Meta<FormFieldStoryArgs> = {
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
  argTypes: {
    zRequired: {
      control: 'boolean',
      description:
        'Adds the required-marker treatment to the projected form label.',
    },
    zType: {
      control: 'select',
      options: ['default', 'error', 'success', 'warning'],
      description: 'Sets the semantic tone for the projected form message.',
    },
  },
  args: {
    zRequired: false,
    zType: 'default',
  },
};

export default meta;
type Story = StoryObj<FormFieldStoryArgs>;

function renderFormFieldStory({
  inputId,
  label,
  placeholder,
  inputType = 'text',
  inputValue = '',
  inputStatus = '',
  message,
}: {
  inputId: string;
  label: string;
  placeholder?: string;
  inputType?: string;
  inputValue?: string;
  inputStatus?: string;
  message?: string;
}): Story['render'] {
  return (args) => ({
    props: {
      ...args,
      inputId,
      label,
      placeholder,
      inputType,
      inputValue,
      inputStatus,
      message,
    },
    template: `
      <z-form-field class="max-w-sm">
        <label z-form-label [for]="inputId" [zRequired]="zRequired">{{ label }}</label>
        <input
          [id]="inputId"
          zInput
          [type]="inputType"
          [placeholder]="placeholder"
          [value]="inputValue"
          [zStatus]="inputStatus"
        />
        @if (message) {
          <z-form-message [zType]="zType">{{ message }}</z-form-message>
        }
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
  });
}

export const Default: Story = {
  render: renderFormFieldStory({
    inputId: 'email',
    label: 'Email',
    inputType: 'email',
    placeholder: 'user@example.com',
    message: "We'll use this for account notifications.",
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for the default label, input, and helper-message composition.',
      },
    },
  },
};

export const Required: Story = {
  args: {
    zRequired: true,
  },
  render: renderFormFieldStory({
    inputId: 'name',
    label: 'Name',
    placeholder: 'Your name',
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for marking required fields without introducing validation state.',
      },
    },
  },
};

export const WithError: Story = {
  args: {
    zRequired: true,
    zType: 'error',
  },
  render: renderFormFieldStory({
    inputId: 'password',
    label: 'Password',
    inputType: 'password',
    inputStatus: 'error',
    message: 'Password must be at least 8 characters',
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for pairing an error input treatment with an inline validation message.',
      },
    },
  },
};

export const WithSuccess: Story = {
  args: {
    zType: 'success',
  },
  render: renderFormFieldStory({
    inputId: 'display-name',
    label: 'Display name',
    inputValue: 'Dahlia',
    inputStatus: 'success',
    message: 'Display name looks good',
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for positive validation feedback after a field value is accepted.',
      },
    },
  },
};
