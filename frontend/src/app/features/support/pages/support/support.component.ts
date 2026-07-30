import {Component, ChangeDetectionStrategy, inject} from '@angular/core';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {PlatformContactDialogService} from '@/features/contact/platform-contact-dialog.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

@Component({
  selector: 'app-support',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContentLayoutComponent, ZardButtonComponent, ZardIconComponent],
  template: `
    <app-content-layout>
      <div
        class="fade-in container mx-auto flex max-w-2xl grow flex-col justify-center px-4 py-8 text-center sm:py-12 md:py-24"
      >
        <h1
          class="mb-6 font-display text-2xl font-bold tracking-tight text-foreground uppercase sm:text-3xl lg:text-4xl"
        >
          Need Help?
        </h1>
        <p class="mx-auto mb-12 max-w-lg text-xl text-muted-foreground">
          event questions go to the organizer. platform and account stuff comes
          to us.
        </p>

        <div class="mx-auto grid w-full max-w-lg gap-6 sm:gap-8">
          <!-- Event Specific Support -->
          <div
            class="rounded-none border border-border bg-card/30 p-8 text-left md:p-10"
          >
            <h2
              class="mb-4 flex items-center gap-2 font-display text-xl font-bold text-foreground"
            >
              <z-icon zType="calendar" class="size-5" />
              Event Questions?
            </h2>
            <p class="mb-4 text-muted-foreground">
              For questions about tickets, times, or venue details for a
              specific event, please
              <strong>contact the event organizer directly</strong>.
            </p>
          </div>

          <!-- Platform Support -->
          <div class="rounded-none border border-border bg-card/30 p-8 md:p-10">
            <h2 class="mb-4 font-display text-xl font-bold text-foreground">
              Platform Support
            </h2>
            <p class="mb-8 text-muted-foreground">
              For account issues, technical problems, or official Braket events:
            </p>

            <button
              type="button"
              z-button
              zType="default"
              zSize="lg"
              (click)="openContactDialog()"
              data-testid="email-support-button"
              class="w-full"
            >
              EMAIL SUPPORT
            </button>
          </div>
        </div>
      </div>
    </app-content-layout>
  `,
})
export class SupportComponent {
  private readonly contactDialog = inject(PlatformContactDialogService);

  openContactDialog(): void {
    this.contactDialog.open({subject: 'Braket support'});
  }
}
