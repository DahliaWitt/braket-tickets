import { ComponentHarness } from '@angular/cdk/testing';

export class CheckInChartComponentHarness extends ComponentHarness {
  static hostSelector = 'app-check-in-chart';

  private getChartContainer = this.locatorFor('.check-in-chart-container');

  async isChartPresent(): Promise<boolean> {
    try {
      await this.getChartContainer();
      return true;
    } catch {
      return false;
    }
  }
}
