import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BRA_MODAL_DATA } from '@ui/components/composites/dialog/dialog.service';
import { BraDialogRef } from '@ui/components/composites/dialog/dialog-ref';
import { ZardButtonComponent } from '@ui/components/primitives/button/button.component';
import { ZardIconComponent } from '@ui/components/primitives/icon/icon.component';
import { toast } from 'ngx-sonner';

import { logger } from '@/utils/logger';
import { BrowserPlatformService } from '@/core/services/browser-platform.service';

export interface ContactCommunityDialogData {
  eventTitle?: string | null;
  organizerContactInfo?: string | null;
  organizerEmail?: string | null;
  organizerName: string;
}

@Component({
  selector: 'app-contact-community-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardButtonComponent, ZardIconComponent],
  template: `
    <section class="flex flex-col gap-4" data-testid="contact-dialog-root">
      @if (email(); as organizerEmail) {
        <section
          class="rounded-xl border border-border bg-muted/30 p-4"
          data-testid="contact-dialog-email-section"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <p class="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                Email
              </p>
              <p
                class="break-all text-sm font-medium text-foreground"
                data-testid="contact-dialog-email-value"
              >
                {{ organizerEmail }}
              </p>
            </div>
            <z-icon zType="mail" class="mt-0.5 shrink-0 text-secondary" />
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              z-button
              zType="outline"
              data-testid="contact-dialog-copy-email"
              (click)="copyEmail()"
            >
              <z-icon zType="copy" class="mr-2" />
              Copy email
            </button>
            <button
              type="button"
              z-button
              data-testid="contact-dialog-draft-email"
              (click)="openEmailDraft()"
            >
              <z-icon zType="arrow-up-right" class="mr-2" />
              Draft email
            </button>
          </div>
        </section>
      }

      @if (contactInfo(); as organizerContactInfo) {
        <section
          class="rounded-xl border border-border bg-muted/30 p-4"
          data-testid="contact-dialog-contact-info-section"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <p class="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                Preferred contact instructions
              </p>
              <p
                class="whitespace-pre-line text-sm leading-relaxed text-foreground"
                data-testid="contact-dialog-contact-info-value"
              >
                {{ organizerContactInfo }}
              </p>
            </div>
            <z-icon zType="message-square" class="mt-0.5 shrink-0 text-secondary" />
          </div>

          <div class="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              z-button
              zType="outline"
              data-testid="contact-dialog-copy-contact-info"
              (click)="copyContactInfo()"
            >
              <z-icon zType="clipboard" class="mr-2" />
              Copy details
            </button>
          </div>
        </section>
      }

      @if (!hasAnyContactMethod()) {
        <section
          class="rounded-xl border border-dashed border-border bg-muted/20 p-4"
          data-testid="contact-dialog-fallback"
        >
          <p class="text-sm leading-relaxed text-muted-foreground">
            {{ organizerName() }} has not shared a direct contact method yet. Check their
            community page or event updates for the latest contact details.
          </p>
        </section>
      }

      <div class="flex justify-end">
        <button
          type="button"
          z-button
          zType="secondary"
          data-testid="contact-dialog-close"
          (click)="close()"
        >
          Done
        </button>
      </div>
    </section>
  `,
})
export class ContactCommunityDialogComponent {
  private readonly dialogRef = inject(BraDialogRef<ContactCommunityDialogComponent>);
  private readonly data = inject<ContactCommunityDialogData>(BRA_MODAL_DATA);
  private readonly browser = inject(BrowserPlatformService);

  protected readonly organizerName = computed(() => this.data.organizerName);
  protected readonly email = computed(() => this.normalize(this.data.organizerEmail));
  protected readonly contactInfo = computed(() => this.normalize(this.data.organizerContactInfo));
  protected readonly hasAnyContactMethod = computed(
    () => this.email() !== null || this.contactInfo() !== null,
  );

  close(): void {
    this.dialogRef.close();
  }

  async copyEmail(): Promise<void> {
    const organizerEmail = this.email();
    if (!organizerEmail) return;

    await this.copyText(organizerEmail, 'Email copied', 'Failed to copy email');
  }

  async copyContactInfo(): Promise<void> {
    const organizerContactInfo = this.contactInfo();
    if (!organizerContactInfo) return;

    await this.copyText(
      organizerContactInfo,
      'Contact details copied',
      'Failed to copy contact details',
    );
  }

  openEmailDraft(): void {
    const organizerEmail = this.email();
    if (!organizerEmail) return;

    const subject = encodeURIComponent(
      `Question about ${this.data.eventTitle?.trim() || 'your event'}`,
    );
    const body = encodeURIComponent(
      `Hello ${this.data.organizerName},\n\nI have a question about your event.\n\n`,
    );
    this.browser.navigateWithAnchor(`mailto:${organizerEmail}?subject=${subject}&body=${body}`);
    this.dialogRef.close();
  }

  private normalize(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private async copyText(
    text: string,
    successMessage: string,
    failureMessage: string,
  ): Promise<void> {
    try {
      await this.browser.writeClipboardText(text);
      toast.success(successMessage);
    } catch (error) {
      logger.error(failureMessage, error);
      toast.error(failureMessage);
    }
  }
}
