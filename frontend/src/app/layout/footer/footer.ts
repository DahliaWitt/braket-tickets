import {Component, ChangeDetectionStrategy, inject} from '@angular/core';
import {RouterLink} from '@angular/router';

import {BraToastService} from '@ui/components/composites/toast/toast.service';
import {FeedbackService} from '@/core/services/feedback.service';
import {logger} from '@/utils/logger';

@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <footer
      class="flex flex-col items-center gap-3 border-t border-border bg-background px-6 py-8 font-mono text-xs tracking-widest text-muted-foreground uppercase md:px-12 md:py-6"
    >
      <nav
        aria-label="Footer"
        class="grid grid-cols-3 gap-x-8 gap-y-3 text-center md:flex md:gap-8"
      >
        <a
          routerLink="/terms"
          class="rounded-sm py-1 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >Terms</a
        >
        <a
          routerLink="/privacy"
          class="rounded-sm py-1 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >Privacy</a
        >
        <a
          routerLink="/support"
          class="rounded-sm py-1 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >Support</a
        >
        <a
          routerLink="/about"
          class="rounded-sm py-1 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >About</a
        >
        <a
          routerLink="/help"
          class="rounded-sm py-1 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
          >Help</a
        >
        <button
          type="button"
          (click)="openFeedback()"
          class="cursor-pointer rounded-sm py-1 uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        >
          Feedback
        </button>
      </nav>
      <div class="hidden text-muted-foreground md:block">
        DIY Transexual Technology
      </div>
    </footer>
  `,
})
export class FooterComponent {
  private readonly feedback = inject(FeedbackService);
  private readonly toast = inject(BraToastService);

  openFeedback(): void {
    void this.feedback
      .open()
      .then((opened) => {
        if (!opened) {
          this.toast.error('Feedback is unavailable right now.');
        }
      })
      .catch((error: unknown) => {
        logger.error('Failed to open Sentry feedback', error);
        this.toast.error('Feedback is unavailable right now.');
      });
  }
}
