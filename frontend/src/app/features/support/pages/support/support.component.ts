import {Component, ChangeDetectionStrategy} from '@angular/core';
import {RouterModule} from '@angular/router';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

@Component({
  selector: 'app-support',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    ContentLayoutComponent,
    ZardButtonComponent,
    ZardIconComponent,
  ],
  template: `
    <app-content-layout>
      <div
        class="container max-w-2xl mx-auto px-4 py-8 sm:py-12 md:py-24 grow flex flex-col justify-center text-center fade-in"
      >
        <h1
          class="text-2xl sm:text-3xl lg:text-4xl font-bold mb-6 tracking-tight font-display uppercase text-foreground"
        >
          Need Help?
        </h1>
        <p class="text-xl text-muted-foreground mb-12 max-w-lg mx-auto">
          We're here to help with any questions or issues you might have.
        </p>

        <div class="grid gap-6 sm:gap-8 max-w-lg mx-auto w-full">
          <!-- Event Specific Support -->
          <div
            class="p-8 md:p-10 border border-border bg-card/30 rounded-none text-left"
          >
            <h2
              class="text-xl font-bold font-display text-foreground mb-4 flex items-center gap-2"
            >
              <z-icon zType="calendar" class="size-5" />
              Event Questions?
            </h2>
            <p class="text-muted-foreground mb-4">
              For questions about tickets, times, or venue details for a
              specific event, please
              <strong>contact the event organizer directly</strong>.
            </p>
          </div>

          <!-- Platform Support -->
          <div class="p-8 md:p-10 border border-border bg-card/30 rounded-none">
            <h2 class="text-xl font-bold font-display text-foreground mb-4">
              Platform Support
            </h2>
            <p class="mb-8 text-muted-foreground">
              For account issues, technical problems, or official Braket events:
            </p>

            <a
              z-button
              zType="default"
              zSize="lg"
              href="mailto:contact@braket.gay?subject=Braket%20support"
              data-testid="email-support-link"
              class="w-full"
            >
              EMAIL SUPPORT
            </a>

            <div class="mt-8 pt-8 border-t border-border/50">
              <p
                class="text-xs text-muted-foreground uppercase tracking-widest mb-3 font-mono"
              >
                Manual Contact Address
              </p>
              <div
                class="bg-background/50 p-3 border border-border inline-block"
              >
                <a
                  href="mailto:contact@braket.gay?subject=Braket%20support"
                  class="font-mono text-sm select-all text-foreground underline decoration-border underline-offset-4 hover:text-primary"
                  data-testid="manual-contact-link"
                  >contact@braket.gay</a
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </app-content-layout>
  `,
})
export class SupportComponent {}
