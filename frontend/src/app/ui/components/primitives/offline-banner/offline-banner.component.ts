import {
  Component,
  ChangeDetectionStrategy,
  inject,
  PLATFORM_ID,
} from '@angular/core';
import {isPlatformBrowser, DOCUMENT} from '@angular/common';
import {toSignal} from '@angular/core/rxjs-interop';
import {fromEvent, merge, map, EMPTY} from 'rxjs';

@Component({
  selector: 'app-offline-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOffline()) {
      <div
        class="animate-in slide-in-from-top-full fixed top-0 right-0 left-0 z-50 flex items-center justify-center gap-2 bg-destructive px-4 py-2 font-mono text-xs tracking-widest text-destructive-foreground uppercase shadow-lg duration-300"
        role="alert"
      >
        <svg
          aria-hidden="true"
          class="size-4 shrink-0"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 20h.01" />
          <path d="M8.5 16.429a5 5 0 0 1 7 0" />
          <path d="M5 12.859a10 10 0 0 1 5.17-2.69" />
          <path d="M19 12.859a10 10 0 0 0-2.007-1.523" />
          <path d="M2 8.82a15 15 0 0 1 4.177-2.643" />
          <path d="M22 8.82a15 15 0 0 0-11.288-3.764" />
          <path d="m2 2 20 20" />
        </svg>
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
          fromEvent(this.document.defaultView, 'online').pipe(map(() => false)),
        )
      : EMPTY,
    {
      initialValue:
        isPlatformBrowser(this.platformId) && this.document.defaultView
          ? !this.document.defaultView.navigator.onLine
          : false,
    },
  );
}
