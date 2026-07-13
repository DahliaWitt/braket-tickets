import {ComponentHarness} from '@angular/cdk/testing';

export class SalesChartComponentHarness extends ComponentHarness {
  static hostSelector = 'app-sales-chart';

  private getChartContainer = this.locatorFor('.sales-chart-container');

  async isChartPresent(): Promise<boolean> {
    try {
      await this.getChartContainer();
      return true;
    } catch {
      return false;
    }
  }
}
