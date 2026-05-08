import {Component, ChangeDetectionStrategy, inject} from '@angular/core';
import {RouterLink} from '@angular/router';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {PlatformContactDialogService} from '@/features/contact/platform-contact-dialog.service';

@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ContentLayoutComponent, RouterLink],
  template: `
    <app-content-layout>
      <div class="grow flex flex-col py-4 md:py-8">
        <!-- Section 1: About Braket -->
        <section
          class="max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-700"
        >
          <h1
            class="text-2xl sm:text-3xl lg:text-4xl font-bold font-display uppercase tracking-tight text-foreground mb-8"
          >
            ABOUT US
          </h1>
          <div class="space-y-5 text-muted-foreground font-sans">
            <p
              class="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100"
            >
              Braket is a collective of trans and queer folks in San Francisco.
              We throw audiovisual dance parties. Dark rooms, heavy bass,
              dancing together. t4t4techno.
            </p>
            <p
              class="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200"
            >
              We built this platform because the ticketing tools out there
              weren't made for spaces like ours. Our communities need to know
              that the people coming through the door share our values and
              respect our spaces. So we built our own system for that.
            </p>
            <p
              class="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300"
            >
              Communities on the platform set their own vetting questions and
              review applicants. Once you're approved, you can buy tickets.
              Communities can trust each other too. If you're vetted by one,
              others in their network can let you in. Admins can create magic
              links to fast-track people they already know.
            </p>
          </div>
        </section>

        <!-- Section 2: Work With Us -->
        <section
          class="max-w-2xl pt-16 md:pt-24 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-500"
        >
          <h2
            class="text-2xl sm:text-3xl lg:text-4xl font-bold font-display uppercase tracking-tight text-foreground mb-8"
          >
            WORK WITH US
          </h2>
          <div class="space-y-5 text-muted-foreground font-sans">
            <p
              class="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-600"
            >
              We want to work with people who share our values and love for
              these spaces. We built this platform with a lot of care,
              purpose-built for communities like ours.
            </p>
            <p
              class="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-700"
            >
              We charge a very modest fee compared to other platforms, just
              enough to keep the lights on. If you run a community and this
              sounds like something you'd want to use, reach out.
            </p>
          </div>
          <button
            type="button"
            (click)="openContactDialog()"
            class="mt-8 px-8 py-4 font-mono text-xs uppercase tracking-widest text-foreground
                   bg-transparent border-2 border-primary rounded-none cursor-pointer
                   transition-colors duration-200
                   hover:bg-primary/10 hover:drop-shadow-[0_0_15px_hsl(var(--primary)/0.4)]
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Get in Touch
          </button>
        </section>

        <!-- Section 3: Platform & Security -->
        <section
          class="max-w-2xl pt-16 md:pt-24 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-900"
        >
          <h2
            class="text-2xl sm:text-3xl lg:text-4xl font-bold font-display uppercase tracking-tight text-foreground mb-8"
          >
            PLATFORM & SECURITY
          </h2>
          <div class="space-y-5 text-muted-foreground font-sans">
            <p
              class="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-1000"
            >
              Braket Tickets is built and operated by us, independently. Your
              privacy matters to us. We don't sell your data to anyone, and we
              take every reasonable measure to keep it safe.
            </p>
            <p
              class="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-[1100ms]"
            >
              Payments are handled by Stripe. We never see or store your card
              details. All connections are encrypted over TLS.
            </p>
            <p
              class="animate-in fade-in slide-in-from-bottom-4 duration-700 delay-[1200ms]"
            >
              For the full details, read our
              <a
                routerLink="/privacy"
                class="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                >Privacy Policy</a
              >
              and
              <a
                routerLink="/terms"
                class="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
                >Terms of Service</a
              >. If something feels off, reach out via our
              <a
                routerLink="/support"
                class="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors"
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

  openContactDialog(): void {
    this.contactDialog.open({subject: 'Working with Braket'});
  }
}
