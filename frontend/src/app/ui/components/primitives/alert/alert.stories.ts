import type { Meta, StoryObj } from '@storybook/angular';
import { argsToTemplate } from '@storybook/angular';

import { ZardAlertComponent } from './alert.component';

const meta: Meta<ZardAlertComponent> = {
  title: 'Braket/Primitives/Alert',
  component: ZardAlertComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Alert is app-proven for operational messaging across ticketing, vetting, payout, and admin workflows. The named stories reflect real product notice types, while the grouped overview acts as a quick reference matrix.',
      },
    },
  },
  argTypes: {
    zType: {
      control: 'select',
      options: ['default', 'success', 'warning', 'error', 'info'],
    },
    zAppearance: {
      control: 'select',
      options: ['outline', 'soft', 'fill'],
    },
    zTitle: { control: 'text' },
    zDescription: { control: 'text' },
    hideIcon: { control: 'boolean' },
  },
  render: (args) => ({
    props: args,
    template: `<z-alert ${argsToTemplate(args)} />`,
  }),
};

export default meta;
type Story = StoryObj<ZardAlertComponent>;

export const PayoutStatus: Story = {
  args: {
    zType: 'success',
    zAppearance: 'soft',
    zTitle: 'Paid Out',
    zDescription: 'The event payout landed in the organizer account.',
  },
  parameters: {
    docs: {
      description: {
        story: 'App-proven payout-success notice for organizer and finance surfaces.',
      },
    },
  },
};

export const TicketSalesPaused: Story = {
  args: {
    zType: 'warning',
    zAppearance: 'soft',
    zTitle: 'Ticket Sales Paused',
    zDescription: 'Users cannot purchase tickets until the organizer resumes sales.',
  },
  parameters: {
    docs: {
      description: {
        story: 'App-proven warning state for paused ticket availability.',
      },
    },
  },
};

export const ExportFailure: Story = {
  args: {
    zType: 'error',
    zAppearance: 'outline',
    zTitle: 'Export Failed',
    zDescription: 'Retry the attendee export or check the export service logs.',
  },
  parameters: {
    docs: {
      description: {
        story: 'App-proven error alert for failed operational workflows like exports or imports.',
      },
    },
  },
};

export const VettingRequired: Story = {
  args: {
    zType: 'info',
    zAppearance: 'soft',
    zTitle: 'Vetting Required',
    zDescription: 'This community requires approval before ticket purchase.',
  },
  parameters: {
    docs: {
      description: {
        story: 'App-proven info notice for gated communities and approval-required flows.',
      },
    },
  },
};

export const OperationalNotices: Story = {
  render: () => ({
    template: `
      <div class="space-y-4 max-w-lg">
        <z-alert
          zType="success"
          zAppearance="soft"
          zTitle="Payout Scheduled"
          zDescription="The next payout will be sent on Friday."
        />
        <z-alert
          zType="warning"
          zAppearance="soft"
          zTitle="Ticket Sales Paused"
          zDescription="Sales are paused while the organizer reviews the event settings."
        />
        <z-alert
          zType="error"
          zAppearance="outline"
          zTitle="Import Failed"
          zDescription="The attendee CSV could not be processed. Try again with a smaller file."
        />
        <z-alert
          zType="info"
          zAppearance="soft"
          zTitle="Vetting Required"
          zDescription="Only approved guests can see this event."
        />
      </div>
    `,
    moduleMetadata: { imports: [ZardAlertComponent] },
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Reference overview of the alert system across the most common operational notice types.',
      },
    },
  },
};
