import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { Meta, StoryObj } from '@storybook/angular';

import { ZardButtonComponent } from '@ui/components/primitives/button/button.component';
import { ZardCardComponent } from '@ui/components/primitives/card/card.component';
import { ZardIconComponent } from '@ui/components/primitives/icon/icon.component';

import { ContentLayoutComponent } from './content-layout.component';

@Component({
  selector: 'bt-story-content-layout-guest-tickets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContentLayoutComponent, ZardCardComponent],
  template: `
    <app-content-layout>
      <div class="flex grow flex-col py-8">
        <div class="mb-8">
          <p class="font-mono text-2xs uppercase tracking-widest text-muted-foreground">
            Guest Access
          </p>
          <h1
            class="mt-2 font-display text-2xl font-bold uppercase tracking-tight text-foreground sm:text-3xl"
          >
            Your tickets
          </h1>
        </div>

        <div class="grid gap-6 md:grid-cols-2">
          <z-card class="overflow-hidden border-border bg-card/80">
            <div class="space-y-6 p-6">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="font-display uppercase tracking-wide text-secondary">
                    Void Sessions Vol. 12
                  </p>
                  <p class="mt-1 font-mono text-2xs uppercase text-muted-foreground">
                    June 20, 2026
                  </p>
                  <p class="mt-1 font-mono text-2xs uppercase text-muted-foreground">
                    VIP admission
                  </p>
                </div>
                <span
                  class="rounded border border-secondary/30 px-2 py-0.5 font-mono text-2xs uppercase text-secondary"
                >
                  Valid
                </span>
              </div>

              <div
                class="flex aspect-square items-center justify-center rounded-lg border border-border bg-background/60"
              >
                <span class="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  QR
                </span>
              </div>

              <p
                class="break-all text-center font-mono text-2xs uppercase tracking-tight text-muted-foreground"
              >
                evt_void_sessions_vip_0001
              </p>
            </div>
          </z-card>

          <z-card class="overflow-hidden border-border bg-card/80">
            <div class="space-y-6 p-6">
              <div class="flex items-start justify-between gap-4">
                <div>
                  <p class="font-display uppercase tracking-wide text-secondary">Signal Loss</p>
                  <p class="mt-1 font-mono text-2xs uppercase text-muted-foreground">
                    July 5, 2026
                  </p>
                  <p class="mt-1 font-mono text-2xs uppercase text-muted-foreground">
                    General admission
                  </p>
                </div>
                <span
                  class="rounded border border-secondary/30 px-2 py-0.5 font-mono text-2xs uppercase text-secondary"
                >
                  Valid
                </span>
              </div>

              <div
                class="flex aspect-square items-center justify-center rounded-lg border border-border bg-background/60"
              >
                <span class="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">
                  QR
                </span>
              </div>

              <p
                class="break-all text-center font-mono text-2xs uppercase tracking-tight text-muted-foreground"
              >
                evt_signal_loss_ga_0004
              </p>
            </div>
          </z-card>
        </div>
      </div>
    </app-content-layout>
  `,
})
class ContentLayoutGuestTicketsStoryComponent {}

@Component({
  selector: 'bt-story-content-layout-legal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContentLayoutComponent],
  template: `
    <app-content-layout>
      <div class="mx-auto max-w-4xl py-8 font-sans">
        <h1
          class="mb-6 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl lg:text-4xl"
        >
          Terms of Service
        </h1>
        <p class="mb-8 text-sm text-muted-foreground">Last Updated: April 6, 2026</p>

        <section class="mb-8">
          <h2 class="mb-4 font-display text-xl text-foreground">1. Agreement to Terms</h2>
          <div class="space-y-4 text-muted-foreground">
            <p>
              By accessing or using the Braket Tickets platform, you agree to be bound by these
              terms and the related privacy policy.
            </p>
            <p>
              This layout is used for long-form legal and policy documents where readability and
              restrained width matter more than call-to-action density.
            </p>
          </div>
        </section>

        <section class="mb-8">
          <h2 class="mb-4 font-display text-xl text-foreground">
            2. Purchasing Tickets and Platform Role
          </h2>
          <div class="space-y-4 text-muted-foreground">
            <p>
              Braket Tickets may act as the event organizer or as the ticketing platform for
              third-party organizers depending on the event listing.
            </p>
            <ul class="list-disc space-y-1 pl-6">
              <li>All-in pricing stays visible through checkout.</li>
              <li>Refund policy details remain in-flow with the legal text.</li>
              <li>Dense prose still reads well inside the fixed central column.</li>
            </ul>
          </div>
        </section>

        <section class="border-l-4 border-primary py-2 pl-4">
          <h2 class="mb-4 font-display text-xl text-foreground">3. Refund Policy</h2>
          <p class="text-muted-foreground">
            All sales are final except as required by law. Cancellations and reschedules are handled
            in the same readable document surface without introducing a second layout treatment.
          </p>
        </section>
      </div>
    </app-content-layout>
  `,
})
class ContentLayoutLegalStoryComponent {}

@Component({
  selector: 'bt-story-content-layout-support',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContentLayoutComponent, ZardButtonComponent, ZardIconComponent],
  template: `
    <app-content-layout>
      <div
        class="container mx-auto flex grow flex-col justify-center px-4 py-8 text-center sm:py-12 md:max-w-2xl md:py-24"
      >
        <h1
          class="mb-6 font-display text-2xl font-bold uppercase tracking-tight text-foreground sm:text-3xl lg:text-4xl"
        >
          Need help?
        </h1>
        <p class="mx-auto mb-12 max-w-lg text-xl text-muted-foreground">
          We are here to help with ticket issues, account problems, and platform questions.
        </p>

        <div class="grid w-full max-w-lg gap-6 sm:gap-8">
          <div class="rounded-none border border-border bg-card/30 p-8 text-left md:p-10">
            <h2 class="mb-4 flex items-center gap-2 font-display text-xl font-bold text-foreground">
              <z-icon zType="calendar" class="size-5" />
              Event questions?
            </h2>
            <p class="text-muted-foreground">
              For timing, venue, or organizer-specific questions, Braket points people to the event
              organizer first.
            </p>
          </div>

          <div class="rounded-none border border-border bg-card/30 p-8 md:p-10">
            <h2 class="mb-4 font-display text-xl font-bold text-foreground">Platform support</h2>
            <p class="mb-8 text-muted-foreground">
              Use the primary call to action when the page is mostly guidance plus one next step.
            </p>

            <z-button zType="default" zSize="lg" class="w-full">Email support</z-button>

            <div class="mt-8 border-t border-border/50 pt-8">
              <p class="mb-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Manual contact address
              </p>
              <div class="inline-block border border-border bg-background/50 p-3">
                <span class="font-mono text-sm">
                  contact<span class="mx-1 text-primary">[at]</span>braket.gay
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </app-content-layout>
  `,
})
class ContentLayoutSupportStoryComponent {}

const meta: Meta<ContentLayoutComponent> = {
  title: 'Braket/Layouts/ContentLayout',
  component: ContentLayoutComponent,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Primary long-form page layout used across guest tickets, legal content, support, dashboard, and other centered single-column surfaces.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<ContentLayoutComponent>;

export const GuestTicketsSurface: Story = {
  render: () => ({
    template: `<bt-story-content-layout-guest-tickets />`,
    moduleMetadata: {
      imports: [ContentLayoutGuestTicketsStoryComponent],
    },
  }),
};

export const LegalDocument: Story = {
  render: () => ({
    template: `<bt-story-content-layout-legal />`,
    moduleMetadata: {
      imports: [ContentLayoutLegalStoryComponent],
    },
  }),
};

export const SupportCenter: Story = {
  render: () => ({
    template: `<bt-story-content-layout-support />`,
    moduleMetadata: {
      imports: [ContentLayoutSupportStoryComponent],
    },
  }),
};
