import { inject, Injectable } from '@angular/core';

import { BrowserPlatformService } from '@/core/services/browser-platform.service';

@Injectable()
export class EventDetailsSidebarFocusService {
  private readonly browser = inject(BrowserPlatformService);
  private triggerElement: HTMLElement | null = null;

  captureCurrentTrigger(): void {
    const activeElement = this.browser.activeElement();
    this.triggerElement = activeElement instanceof HTMLElement ? activeElement : null;
  }

  restoreTrigger(): void {
    const trigger = this.triggerElement;
    this.triggerElement = null;
    if (trigger?.isConnected) {
      trigger.focus();
    }
  }
}
