import {ComponentHarness} from '@angular/cdk/testing';

export class SalesChartComponentHarness extends ComponentHarness {
  static hostSelector = 'app-sales-chart';

  private getChartContainer = this.locatorFor('.sales-chart-container');
  private getRenderedSeries = this.locatorForOptional(
    '.sales-chart-container .apexcharts-series',
  );
  private getRenderedSvg = this.locatorForOptional(
    '.sales-chart-container svg',
  );

  async isChartPresent(): Promise<boolean> {
    try {
      await this.getChartContainer();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Whether ApexCharts finished drawing the series. The shell svg mounts
   * before the chart-type lookup, so asserting on the svg alone passes even
   * when the type renderer failed to instantiate — the series group only
   * exists after a successful render.
   */
  async hasRenderedSeries(): Promise<boolean> {
    return (await this.getRenderedSeries()) !== null;
  }

  /** Whether the chart mounted its svg (renders even for an empty series). */
  async hasRenderedSvg(): Promise<boolean> {
    return (await this.getRenderedSvg()) !== null;
  }
}
