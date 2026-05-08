import { ComponentHarness } from '@angular/cdk/testing';

export class CheckInSummaryStripHarness extends ComponentHarness {
  static hostSelector = 'app-check-in-summary-strip';

  private readonly getRateEl = this.locatorFor('[data-testid="checkin-rate"]');
  private readonly getScannedEl = this.locatorFor('[data-testid="checkin-scanned"]');
  private readonly getLastScanEl = this.locatorFor('[data-testid="checkin-last-scan"]');
  private readonly getPeakHourEl = this.locatorForOptional('[data-testid="checkin-peak-hour"]');

  async getCheckInRate(): Promise<string> {
    return (await this.getRateEl()).text();
  }

  async getTotalScanned(): Promise<string> {
    return (await this.getScannedEl()).text();
  }

  async getLastScanRelative(): Promise<string> {
    return (await this.getLastScanEl()).text();
  }

  /** Returns null when peak hour is not shown (door-rush mode or no data). */
  async getPeakHour(): Promise<string | null> {
    const el = await this.getPeakHourEl();
    if (!el) return null;
    const text = (await el.text()).trim();
    return text === '—' ? null : text;
  }
}
