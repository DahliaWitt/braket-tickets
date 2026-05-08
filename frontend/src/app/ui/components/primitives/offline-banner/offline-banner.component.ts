import { Component, ChangeDetectionStrategy, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DOCUMENT } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { fromEvent, merge, map, EMPTY } from 'rxjs';
import { ZardIconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-offline-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardIconComponent],
  template: `
    @if (isOffline()) {
      <div
        class="bg-destructive text-destructive-foreground px-4 py-2 flex items-center justify-center gap-2 text-xs font-mono uppercase tracking-widest fixed top-0 left-0 right-0 z-50 shadow-lg animate-in slide-in-from-top-full duration-300"
        role="alert"
      >
        <z-icon zType="wifi-off" zSize="sm" />
        <span>No Internet Connection</span>
      </div>
    }
  `,
})
export class OfflineBannerComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);

  readonly isOffline = toSignal(
    isPlatformBrowser(this.platformId) && this.document.defaultView
      ? merge(
          fromEvent(this.document.defaultView, 'offline').pipe(map(() => true)),
          fromEvent(this.document.defaultView, 'online').pipe(map(() => false))
        )
      : EMPTY,
    {
      initialValue:
        isPlatformBrowser(this.platformId) && this.document.defaultView
          ? !this.document.defaultView.navigator.onLine
          : false,
    }
  );
}
