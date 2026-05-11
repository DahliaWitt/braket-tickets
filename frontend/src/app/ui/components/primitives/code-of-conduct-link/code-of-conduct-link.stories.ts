import type {Meta, StoryObj} from '@storybook/angular';
import {argsToTemplate} from '@storybook/angular';

import {BraCodeOfConductLinkComponent} from './code-of-conduct-link.component';

const meta: Meta<BraCodeOfConductLinkComponent> = {
  title: 'Braket/Primitives/CodeOfConductLink',
  component: BraCodeOfConductLinkComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'App-proven primitive for showing community code-of-conduct copy from event and community surfaces.',
      },
    },
  },
  argTypes: {
    codeOfConduct: {control: 'text'},
  },
};

export default meta;
type Story = StoryObj<BraCodeOfConductLinkComponent>;

export const Default: Story = {
  args: {
    codeOfConduct:
      'Respect the space and each other.\n\nNo harassment, discrimination, or hate speech.\nConsent is mandatory.\nLook out for your community.',
  },
  render: (args) => ({
    props: args,
    template: `<bra-code-of-conduct-link ${argsToTemplate(args)} />`,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven long-form conduct copy that opens from community context.',
      },
    },
  },
};

export const ShortContent: Story = {
  args: {
    codeOfConduct: 'Be kind. Have fun. Stay safe.',
  },
  render: (args) => ({
    props: args,
    template: `<bra-code-of-conduct-link ${argsToTemplate(args)} />`,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Library reference for the same trigger when the conduct copy is very short.',
      },
    },
  },
};

export const OnDarkBackground: Story = {
  args: {
    codeOfConduct:
      'Respect the space and each other.\n\nNo harassment, discrimination, or hate speech.',
  },
  render: (args) => ({
    props: args,
    template: `
      <div class="rounded-lg bg-card p-6">
        <bra-code-of-conduct-link ${argsToTemplate(args)} />
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven contrast check for the link when it appears on card-like dark surfaces.',
      },
    },
  },
};
