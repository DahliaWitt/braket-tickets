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
      <div class="rounded-lg border border-border bg-muted/30 p-4">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 space-y-1">
            <p
              class="font-mono text-xs tracking-widest text-muted-foreground uppercase"
            >
              Email
            </p>
            <p
              class="text-sm font-medium break-all text-foreground"
              data-testid="platform-contact-email"
            >
              {{ email() }}
            </p>
          </div>
          <z-icon zType="mail" class="mt-0.5 shrink-0 text-secondary" />
        </div>

        <div class="mt-4 grid gap-2 sm:grid-cols-2">
          <a
            z-button
            zType="default"
            zSize="lg"
            [href]="mailtoHref()"
            data-testid="platform-contact-open-mail"
            class="w-full"
          >
            <z-icon zType="mail" />
            Open mail client
          </a>
          <button
            type="button"
            z-button
            zType="outline"
            zSize="lg"
            data-testid="platform-contact-copy-email"
            class="w-full"
            (click)="copyEmail()"
          >
            <z-icon zType="copy" />
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
      toast.success('email copied');
    } catch (error) {
      logger.error('Failed to copy email', error);
      toast.error("couldn't copy email, try again");
    }
  }
}
