import {Component, ChangeDetectionStrategy} from '@angular/core';
import {RouterLink} from '@angular/router';
import {ContentLayoutComponent} from '@/layout/content-layout/content-layout.component';
import {OUTLINE_MONO_CTA_CLASS} from '@/features/shared/outline-cta';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ContentLayoutComponent],
  template: `
    <app-content-layout>
      <div
        class="flex grow flex-col items-center justify-center px-6 text-center"
      >
        <div class="fade-in max-w-2xl space-y-8">
          <!-- 404 -->
          <div class="relative">
            <h1
              class="font-display text-8xl font-bold tracking-tighter text-primary md:text-9xl"
            >
              404
            </h1>
          </div>

          <!-- Copy matching brand voice -->
          <div class="fade-in-delay-1 space-y-4">
            <p class="font-display text-2xl text-foreground md:text-3xl">
              oopsie woopsie, uwu
            </p>
            <p class="text-lg leading-relaxed text-muted-foreground md:text-xl">
              this page doesn't exist. no fucky wucky to fix — the url just goes
              nowhere.
            </p>
            <p class="mono-label text-2xs text-muted-foreground">
              error 404 · page not found
            </p>
          </div>

          <!-- Go Home Button -->
          <div class="fade-in-delay-2 pt-8">
            <a
              routerLink="/"
              data-testid="go-home-button"
              [class]="ctaClass + ' w-full sm:w-auto'"
              aria-label="Navigate to home"
            >
              go home
            </a>
          </div>
        </div>
      </div>
    </app-content-layout>
  `,
})
export class NotFoundComponent {
  protected readonly ctaClass = OUTLINE_MONO_CTA_CLASS;
}
