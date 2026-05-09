import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  EnvironmentInjector,
  inject,
  runInInjectionContext,
} from '@angular/core';
import {RouterOutlet} from '@angular/router';
import {BraToastComponent} from '@ui/components/composites/toast/toast.component';
import {OfflineBannerComponent} from '@ui/components/primitives/offline-banner/offline-banner.component';
import {DevOverlayComponent} from '@ui/components/composites/dev-overlay/dev-overlay.component';
import {SeoService} from '@/core/services/seo.service';
import {logger} from '@/utils/logger';

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
  private readonly injector = inject(EnvironmentInjector);
  private seo = inject(SeoService);

  constructor() {
    this.seo.init();
    afterNextRender({
      read: () => {
        void import('./core/services/analytics.service')
          .then(({AnalyticsService}) => {
            return runInInjectionContext(this.injector, () =>
              inject(AnalyticsService).warmup(),
            );
          })
          .catch((error: unknown) => {
            logger.error('AnalyticsService.warmup failed', error);
          });
      },
    });
  }
}
