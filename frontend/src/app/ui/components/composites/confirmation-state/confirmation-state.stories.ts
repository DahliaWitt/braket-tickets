import type { Meta, StoryObj } from '@storybook/angular';

import { ZardButtonComponent } from '@ui/components/primitives/button/button.component';

import { ConfirmationStateComponent } from './confirmation-state.component';

const meta: Meta<ConfirmationStateComponent> = {
  title: 'Braket/Composites/ConfirmationState',
  component: ConfirmationStateComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Product-real confirmation states based on Braket auth flows. These stories mirror how the component is actually used in verification, email-change, and social sign-in confirmations rather than generic success/error demos.',
      },
    },
  },
  argTypes: {
    variant: {
      control: 'select',
      options: ['loading', 'success', 'error', 'warning', 'info'],
    },
    icon: { control: 'text' },
    title: { control: 'text' },
    description: { control: 'text' },
    loading: { control: 'boolean' },
    iconId: { control: 'text' },
    descriptionId: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<ConfirmationStateComponent>;

export const VerificationLoading: Story = {
  args: {
    variant: 'loading',
    icon: 'loader-circle',
    title: 'Verifying your email...',
    description: 'Just a moment while we confirm your email address.',
    loading: true,
  },
};

export const VerificationSuccess: Story = {
  render: () => ({
    template: `
      <app-confirmation-state
        iconId="success-icon"
        icon="check"
        title="Email Verified!"
        description="Your email has been verified. You are being logged in and redirected..."
        variant="success"
      >
        <a
          z-button
          zType="default"
          class="w-full font-display uppercase tracking-wider bg-foreground text-background hover:bg-foreground/90"
        >
          Go to Login
        </a>
      </app-confirmation-state>
    `,
    moduleMetadata: {
      imports: [ConfirmationStateComponent, ZardButtonComponent],
    },
  }),
};

export const EmailChangePending: Story = {
  render: () => ({
    template: `
      <app-confirmation-state
        iconId="pending-icon"
        icon="mail"
        title="Almost Done"
        description="Request confirmed. Now verify the link sent to your new inbox to finish."
        variant="warning"
      >
        <a
          z-button
          zType="ghost"
          class="w-full font-mono uppercase tracking-widest text-xs border border-border text-muted-foreground"
        >
          Back to Account
        </a>
      </app-confirmation-state>
    `,
    moduleMetadata: {
      imports: [ConfirmationStateComponent, ZardButtonComponent],
    },
  }),
};

export const SocialSigninError: Story = {
  render: () => ({
    template: `
      <app-confirmation-state
        icon="x"
        title="Authentication unavailable"
        description="Sign-in could not be completed. Please try again."
        variant="error"
      >
        <a
          z-button
          zType="ghost"
          class="w-full font-mono uppercase tracking-widest text-xs border border-border text-muted-foreground"
        >
          Back to Auth
        </a>
      </app-confirmation-state>
    `,
    moduleMetadata: {
      imports: [ConfirmationStateComponent, ZardButtonComponent],
    },
  }),
};

export const SocialSigninSuccess: Story = {
  render: () => ({
    template: `
      <app-confirmation-state
        icon="check"
        title="You are in"
        description="Your session is ready. Head inside."
        variant="success"
      >
        <button
          z-button
          type="button"
          class="w-full font-display uppercase tracking-wider bg-foreground text-background hover:bg-foreground/90"
        >
          Head Inside
        </button>
      </app-confirmation-state>
    `,
    moduleMetadata: {
      imports: [ConfirmationStateComponent, ZardButtonComponent],
    },
  }),
};
