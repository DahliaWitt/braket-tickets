import {Component, ChangeDetectionStrategy, inject} from '@angular/core';
import {RouterLink} from '@angular/router';

import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {FooterFeedbackDialogComponent} from './footer-feedback-dialog.component';
import {logger} from '@/utils/logger';

@Component({
  selector: 'app-footer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <footer
      class="px-6 py-8 md:px-12 md:py-6 border-t border-border bg-background text-muted-foreground text-xs flex flex-col items-center gap-3 uppercase tracking-widest font-mono"
    >
      <nav
        aria-label="Footer"
        class="grid grid-cols-3 gap-x-8 gap-y-3 text-center md:flex md:gap-8"
      >
        <a
          routerLink="/terms"
          class="hover:text-foreground transition-colors py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
          >Terms</a
        >
        <a
          routerLink="/privacy"
          class="hover:text-foreground transition-colors py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
          >Privacy</a
        >
        <a
          routerLink="/support"
          class="hover:text-foreground transition-colors py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
          >Support</a
        >
        <a
          routerLink="/about"
          class="hover:text-foreground transition-colors py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
          >About</a
        >
        <a
          routerLink="/help"
          class="hover:text-foreground transition-colors py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
          >Help</a
        >
        <button
          type="button"
          (click)="openFeedback()"
          class="hover:text-foreground transition-colors cursor-pointer uppercase py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
        >
          Feedback
        </button>
      </nav>
      <div class="hidden md:block text-muted-foreground">
        DIY Transexual Technology
      </div>
    </footer>
  `,
})
export class FooterComponent {
  private readonly dialogService = inject(BraDialogService);

  openFeedback(): void {
    try {
      this.dialogService.create({
        zTitle: 'Feedback',
        zDescription: 'Tell us what happened or what you want to see next.',
        zContent: FooterFeedbackDialogComponent,
        zHideFooter: true,
        zMaskClosable: false,
        zWidth: 'min(32rem, calc(100vw - 2rem))',
      });
    } catch (error) {
      logger.error('Failed to open feedback dialog', error);
    }
  }
}
