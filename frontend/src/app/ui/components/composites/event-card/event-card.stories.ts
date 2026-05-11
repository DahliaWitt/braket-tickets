import {Meta, StoryObj} from '@storybook/angular';

import {EventCardComponent, type EventCardData} from './event-card.component';

const BASE_EVENT: EventCardData = {
  _id: 'evt_void_sessions',
  title: 'Void Sessions Vol. 12',
  description:
    'A late-night warehouse session with dense low-end, projection work, and a strict no-phone floor policy.',
  date: '2026-06-20T22:00:00.000Z',
  location: 'East Warehouse',
  price: 3500,
  totalTickets: 160,
  soldCount: 118,
  ticketSalesStatus: 'active',
  visibility: 'public',
  posterUrl: '/waterfallTexture.webp',
};

const meta: Meta<EventCardComponent> = {
  title: 'Braket/Composites/EventCard',
  component: EventCardComponent,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Event card is an app-proven composite used on landing and community event surfaces. These stories focus on the real product states the card needs to handle, then document layout stress cases separately.',
      },
    },
  },
  argTypes: {
    event: {control: 'object'},
    priority: {control: 'boolean'},
    showBuyButton: {control: 'boolean'},
  },
  args: {
    event: BASE_EVENT,
    priority: false,
    showBuyButton: true,
  },
  render: (args) => ({
    props: args,
    template: `
      <div class="mx-auto w-full max-w-xl">
        <app-event-card
          [event]="event"
          [priority]="priority"
          [showBuyButton]="showBuyButton"
        />
      </div>
    `,
  }),
};

export default meta;
type Story = StoryObj<EventCardComponent>;

export const Default: Story = {
  name: 'Public Event Listing',
  parameters: {
    docs: {
      description: {
        story:
          'App-proven default state for public event discovery, including poster art, price, availability, and the primary purchase action.',
      },
    },
  },
};

export const WithoutPoster: Story = {
  args: {
    event: {
      ...BASE_EVENT,
      _id: 'evt_signal_loss',
      title: 'Signal Loss',
      posterUrl: null,
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          'App-proven fallback when an event has no poster asset. The layout should still read cleanly in discovery grids.',
      },
    },
  },
};

export const SoldOut: Story = {
  args: {
    event: {
      ...BASE_EVENT,
      _id: 'evt_sold_out',
      title: 'Subterranean Archive',
      isSoldOut: true,
      soldCount: 160,
      ticketSalesStatus: 'ended',
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          'App-proven state for closed inventory. This is one of the main product conditions the card must communicate clearly.',
      },
    },
  },
};

export const SalesPaused: Story = {
  args: {
    event: {
      ...BASE_EVENT,
      _id: 'evt_paused',
      title: 'Afterhours Assembly',
      ticketSalesStatus: 'paused',
      soldCount: 84,
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          'App-proven paused-sales treatment for events that remain visible but are not currently purchasable.',
      },
    },
  },
};

export const InfoOnly: Story = {
  args: {
    showBuyButton: false,
    event: {
      ...BASE_EVENT,
      _id: 'evt_info_only',
      title: 'Closed-Door Screening',
      visibility: 'private',
    },
  },
  parameters: {
    docs: {
      description: {
        story:
          'App-proven informational card state for events that should be visible without exposing the primary buy action.',
      },
    },
  },
};

export const NarrowContainer: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div class="mx-auto w-88">
        <app-event-card
          [event]="event"
          [priority]="priority"
          [showBuyButton]="showBuyButton"
        />
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Reference stress case for tighter containers. Useful when validating that the composite still holds together in denser side rails.',
      },
    },
  },
};

export const WideContainer: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div class="mx-auto w-full max-w-4xl">
        <app-event-card
          [event]="event"
          [priority]="priority"
          [showBuyButton]="showBuyButton"
        />
      </div>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'Reference stress case for spacious layouts and featured placements.',
      },
    },
  },
};

export const CommunityEventsGrid: Story = {
  render: () => ({
    props: {
      featured: BASE_EVENT,
      alternate: {
        ...BASE_EVENT,
        _id: 'evt_alternate',
        title: 'Body Language',
        posterUrl: null,
        location: 'Lower Level',
        price: 2200,
        soldCount: 43,
        description:
          'A tighter room, a shorter run, and a faster ticket burn for the community-only set.',
      } satisfies EventCardData,
    },
    template: `
      <section class="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <div class="flex items-center gap-4 px-1">
          <h2 class="font-display text-2xl font-bold uppercase tracking-tight text-foreground">
            Community Events
          </h2>
          <span class="hidden h-px grow bg-border sm:block"></span>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
          <app-event-card [event]="featured" [priority]="true" />
          <app-event-card [event]="alternate" />
        </div>
      </section>
    `,
  }),
  parameters: {
    docs: {
      description: {
        story:
          'App-proven composition that mirrors the multi-card grid used on community event surfaces.',
      },
    },
  },
};
