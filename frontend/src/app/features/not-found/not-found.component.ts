import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ZardButtonComponent } from '@ui/components/primitives/button/button.component';
import { ContentLayoutComponent } from '@/layout/content-layout/content-layout.component';

@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, RouterLink, ContentLayoutComponent],
  template: `
    <app-content-layout>

      <div class="flex flex-col items-center justify-center grow text-center px-6">
        <div class="space-y-8 max-w-2xl fade-in">
          <!-- 404 -->
          <div class="relative">
            <h1
              class="text-8xl md:text-9xl font-display font-bold tracking-tighter text-primary"
            >
              404
            </h1>
          </div>

          <!-- Copy matching brand voice -->
          <div class="space-y-4 fade-in-delay-1">
            <p class="text-2xl md:text-3xl font-display text-foreground">
              Oopsie Woopsie! UwU
            </p>
            <p class="text-lg md:text-xl text-muted-foreground leading-relaxed">
              We made a fucky wucky!! A wittle fucko boingo!
            </p>
            <p class="text-base md:text-lg text-muted-foreground/80 font-mono uppercase tracking-wider">
              The code monkeys at our headquarters are working VEWY HAWD to fix this!
            </p>
          </div>

          <!-- Go Home Button -->
          <div class="pt-8 fade-in-delay-2">
            <z-button
              zType="default"
              zSize="lg"
              zShape="square"
              routerLink="/"
              data-testid="go-home-button"
              class="w-full sm:w-auto text-xl px-10 py-4 border-2 border-primary uppercase tracking-widest transition-colors"
              aria-label="Navigate to home"
            >
              Go Home
            </z-button>
          </div>
        </div>
      </div>

    </app-content-layout>
  `,
  styles: `
  `,
})
export class NotFoundComponent {
}
