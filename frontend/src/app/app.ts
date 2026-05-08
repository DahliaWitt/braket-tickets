import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import {RouterOutlet} from '@angular/router';
import {BraToastComponent} from '@ui/components/composites/toast/toast.component';
import {OfflineBannerComponent} from '@ui/components/primitives/offline-banner/offline-banner.component';
import {DevOverlayComponent} from '@ui/components/composites/dev-overlay/dev-overlay.component';
import {AnalyticsService} from '@/core/services/analytics.service';
import {SeoService} from '@/core/services/seo.service';

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
    <bra-toast />
    <app-dev-overlay />
  `,
})
export class App {
  private analytics = inject(AnalyticsService);
  private seo = inject(SeoService);

  constructor() {
    this.seo.init();
    afterNextRender({
      read: () => {
        void this.analytics.warmup();
      },
    });
  }
}
