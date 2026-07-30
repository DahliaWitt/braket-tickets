import {Component, ChangeDetectionStrategy, inject} from '@angular/core';
import {RouterLink} from '@angular/router';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {PlatformContactDialogService} from '@/features/contact/platform-contact-dialog.service';
import {OUTLINE_MONO_CTA_CLASS} from '@/features/shared/outline-cta';

@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContentLayoutComponent, RouterLink],
  template: `
    <app-content-layout>
      <div class="flex grow flex-col py-4 md:py-8">
        <!-- Section 1: About Braket -->
        <section class="fade-in max-w-2xl">
          <h1
            class="mb-8 font-display text-2xl font-bold tracking-tight text-foreground uppercase sm:text-3xl lg:text-4xl"
          >
            ABOUT US
          </h1>
          <div class="space-y-5 font-sans text-muted-foreground">
            <p>
              Braket is a collective of trans and queer folks in San Francisco.
              We throw audiovisual dance parties. Dark rooms, heavy bass,
              dancing together. t4t4techno.
            </p>
            <p>
              We built this platform because the ticketing tools out there
              weren't made for spaces like ours. Our communities need to know
              that the people coming through the door share our values and
              respect our spaces. So we built our own system for that.
            </p>
            <p>
              Communities on the platform set their own vetting questions and
              review applicants. Once you're approved, you can buy tickets.
              Communities can trust each other too. If you're vetted by one,
              others in their network can let you in. Admins can create magic
              links to fast-track people they already know.
            </p>
          </div>
        </section>

        <!-- Section 2: Work With Us -->
        <section class="fade-in-delay-1 max-w-2xl pt-16 md:pt-24">
          <h2
            class="mb-8 font-display text-2xl font-bold tracking-tight text-foreground uppercase sm:text-3xl lg:text-4xl"
          >
            WORK WITH US
          </h2>
          <div class="space-y-5 font-sans text-muted-foreground">
            <p>
              We want to work with people who share our values and love for
              these spaces. We built this platform with a lot of care,
              purpose-built for communities like ours.
            </p>
            <p>
              We charge a very modest fee compared to other platforms, just
              enough to keep the lights on. If you run a community and this
              sounds like something you'd want to use, reach out.
            </p>
          </div>
          <button
            type="button"
            (click)="openContactDialog()"
            data-testid="about-contact-cta"
            [class]="ctaClass + ' mt-8'"
          >
            get in touch
          </button>
        </section>

        <!-- Section 3: Platform & Security -->
        <section class="fade-in-delay-2 max-w-2xl pt-16 md:pt-24">
          <h2
            class="mb-8 font-display text-2xl font-bold tracking-tight text-foreground uppercase sm:text-3xl lg:text-4xl"
          >
            PLATFORM & SECURITY
          </h2>
          <div class="space-y-5 font-sans text-muted-foreground">
            <p>
              Braket Tickets is built and operated by us, independently. Your
              privacy matters to us. We don't sell your data to anyone, and we
              take every reasonable measure to keep it safe.
            </p>
            <p>
              Payments are handled by Stripe. We never see or store your card
              details. All connections are encrypted over TLS.
            </p>
            <p>
              For the full details, read our
              <a
                routerLink="/privacy"
                class="text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
                >Privacy Policy</a
              >
              and
              <a
                routerLink="/terms"
                class="text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
                >Terms of Service</a
              >. If something feels off, reach out via our
              <a
                routerLink="/support"
                class="text-primary underline underline-offset-4 transition-colors hover:text-primary/80"
                >Support</a
              >
              page.
            </p>
          </div>
        </section>
      </div>
    </app-content-layout>
  `,
})
export class AboutComponent {
  private readonly contactDialog = inject(PlatformContactDialogService);
  protected readonly ctaClass = OUTLINE_MONO_CTA_CLASS;

  openContactDialog(): void {
    this.contactDialog.open({subject: 'Working with Braket'});
  }
}
