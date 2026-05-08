import {inject, Injectable} from '@angular/core';

import {BraDialogService} from '@ui/components/composites/dialog/dialog.service';
import {
  PlatformContactDialogComponent,
  type PlatformContactDialogData,
} from './platform-contact-dialog.component';

export interface PlatformContactDialogOptions {
  subject?: string;
}

@Injectable({
  providedIn: 'root',
})
export class PlatformContactDialogService {
  private readonly dialog = inject(BraDialogService);

  open(options: PlatformContactDialogOptions = {}): void {
    const email = this.getEmail();

    this.dialog.create<
      PlatformContactDialogComponent,
      PlatformContactDialogData
    >({
      zTitle: 'Contact Braket',
      zDescription:
        'Open a draft, or copy the address if your mail app does not open.',
      zContent: PlatformContactDialogComponent,
      zData: {
        email,
        mailtoHref: this.createMailtoHref(email, options.subject),
      },
      zHideFooter: true,
      zWidth: 'min(32rem, calc(100vw - 2rem))',
    });
  }

  private getEmail(): string {
    const user = 'contact';
    const domain = 'braket';
    const tld = 'gay';
    return `${user}@${domain}.${tld}`;
  }

  private createMailtoHref(email: string, subject?: string): string {
    const trimmedSubject = subject?.trim();
    if (!trimmedSubject) {
      return `mailto:${email}`;
    }
    return `mailto:${email}?subject=${encodeURIComponent(trimmedSubject)}`;
  }
}
