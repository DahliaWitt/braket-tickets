import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import {toast} from 'ngx-sonner';

import {BrowserPlatformService} from '@/core/services/browser-platform.service';
import {logger} from '@/utils/logger';
import {BraDialogRef} from '@ui/components/composites/dialog/dialog-ref';
import {BRA_MODAL_DATA} from '@ui/components/composites/dialog/dialog.service';
import {ZardButtonComponent} from '@ui/components/primitives/button/button.component';
import {ZardIconComponent} from '@ui/components/primitives/icon/icon.component';

export interface PlatformContactDialogData {
  email: string;
  mailtoHref: string;
}

@Component({
  selector: 'app-platform-contact-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardIconComponent],
  template: `
    <section class="flex flex-col gap-5" data-testid="platform-contact-dialog">
      <div class="rounded-xl border border-border bg-muted/30 p-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 space-y-1">
            <p
              class="text-xs font-mono uppercase tracking-widest text-muted-foreground"
            >
              Email
            </p>
            <p
              class="break-all text-sm font-medium text-foreground"
              data-testid="platform-contact-email"
            >
              {{ email() }}
            </p>
          </div>
          <z-icon zType="mail" class="mt-0.5 shrink-0 text-secondary" />
        </div>

        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <a
            [href]="mailtoHref()"
            data-testid="platform-contact-open-mail"
            class="inline-flex h-11 w-full cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-[transform,color,background-color,opacity] outline-none hover:bg-primary/90 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-97 dark:bg-primary/90 dark:hover:bg-primary/85 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <z-icon zType="mail" class="mr-2" />
            Open mail client
          </a>
          <button
            type="button"
            z-button
            zType="outline"
            data-testid="platform-contact-copy-email"
            class="w-full"
            (click)="copyEmail()"
          >
            <z-icon zType="copy" class="mr-2" />
            Copy email
          </button>
        </div>
      </div>

      <div class="flex justify-end">
        <button
          type="button"
          z-button
          zType="secondary"
          data-testid="platform-contact-close"
          (click)="close()"
        >
          Done
        </button>
      </div>
    </section>
  `,
})
export class PlatformContactDialogComponent {
  private readonly dialogRef = inject(
    BraDialogRef<PlatformContactDialogComponent>,
  );
  private readonly data = inject<PlatformContactDialogData>(BRA_MODAL_DATA);
  private readonly browser = inject(BrowserPlatformService);

  protected readonly email = computed(() => this.data.email);
  protected readonly mailtoHref = computed(() => this.data.mailtoHref);

  close(): void {
    this.dialogRef.close();
  }

  async copyEmail(): Promise<void> {
    try {
      await this.browser.writeClipboardText(this.data.email);
      toast.success('Email copied');
    } catch (error) {
      logger.error('Failed to copy email', error);
      toast.error('Failed to copy email');
    }
  }
}
