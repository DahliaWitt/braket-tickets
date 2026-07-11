import {Component, input, ChangeDetectionStrategy} from '@angular/core';
import {ChartCoreComponent} from 'ng-apexcharts';
import type {ChartOptions} from '../sales-chart/sales-chart.component';

@Component({
  selector: 'app-check-in-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChartCoreComponent],
  template: `
    <div class="check-in-chart-container">
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
export class CheckInChartComponent {
  readonly options = input.required<ChartOptions>();
}
