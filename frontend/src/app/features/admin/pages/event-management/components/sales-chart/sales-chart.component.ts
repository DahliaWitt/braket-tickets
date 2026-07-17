import {Component, input, ChangeDetectionStrategy} from '@angular/core';
import {ChartCoreComponent} from 'ng-apexcharts';
import type {ChartOptions} from '../chart-options';

import '../apexcharts-registration';

/**
 * Lazy-loaded sales chart component.
 *
 * This component wraps ApexCharts (~500KB) and is loaded on-demand using @defer
 * to avoid blocking initial page load.
 */
@Component({
  selector: 'app-sales-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartCoreComponent],
  template: `
    <div class="sales-chart-container">
      <apx-chart-core
        [series]="options().series"
        [chart]="options().chart"
        [xaxis]="options().xaxis"
        [yaxis]="options().yaxis"
        [dataLabels]="options().dataLabels"
        [stroke]="options().stroke"
        [fill]="options().fill"
        [grid]="options().grid"
        [tooltip]="options().tooltip"
        [markers]="options().markers"
        [theme]="options().theme"
        [colors]="options().colors"
      />
    </div>
  `,
})
export class SalesChartComponent {
  readonly options = input.required<ChartOptions>();
}
