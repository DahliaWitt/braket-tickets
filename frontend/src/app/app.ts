import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import {
  NavigationCancel,
  NavigationCancellationCode,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  type Event as RouterEvent,
  Router,
  RouterOutlet,
} from '@angular/router';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {filter} from 'rxjs/operators';
import {BraToastComponent} from '@ui/components/composites/toast/toast.component';
import {OfflineBannerComponent} from '@ui/components/primitives/offline-banner/offline-banner.component';
import {DevOverlayComponent} from '@ui/components/composites/dev-overlay/dev-overlay.component';
import {SeoService} from '@/core/services/seo.service';

export function isInitialNavigationTerminalEvent(
  event: RouterEvent,
): event is
  | NavigationEnd
  | NavigationCancel
  | NavigationError
  | NavigationSkipped {
  return (
    event instanceof NavigationEnd ||
    event instanceof NavigationError ||
    event instanceof NavigationSkipped ||
    (event instanceof NavigationCancel &&
      event.code !== NavigationCancellationCode.Redirect &&
      event.code !== NavigationCancellationCode.SupersededByNewNavigation)
  );
}

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    BraToastComponent,
    OfflineBannerComponent,
    DevOverlayComponent,
  ],
  template: `
    <app-offline-banner />
    @if (initialNavigationPending()) {
      <div
        data-testid="initial-route-shell"
        class="app-boot-shell app-boot-shell--overlay"
        role="status"
        aria-live="polite"
        aria-label="Loading Braket Tickets"
      >
        <div class="app-boot-loader">
          <div class="app-boot-loader-inner">
            <div class="app-boot-spinner" aria-hidden="true"></div>
            <div class="app-boot-status">loading</div>
          </div>
        </div>
        <div class="app-boot-frame">
          <div class="app-boot-wordmark">Braket Tickets</div>
        </div>
      </div>
    }
    <router-outlet />
    @defer (on immediate) {
      <bra-toast />
    }
    @defer (on idle) {
      <app-dev-overlay />
    }
  `,
})
export class App {
  private readonly seo = inject(SeoService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly initialNavigationPending = signal(true);

  constructor() {
    this.seo.init();

    if (this.router.navigated) {
      this.initialNavigationPending.set(false);
      return;
    }

    this.router.events
      .pipe(
        filter(isInitialNavigationTerminalEvent),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.initialNavigationPending.set(false);
      });
  }
}
