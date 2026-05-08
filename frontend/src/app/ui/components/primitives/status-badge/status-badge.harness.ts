import { ComponentHarness } from '@angular/cdk/testing';

export class BraStatusBadgeHarness extends ComponentHarness {
  static hostSelector = 'bra-status-badge';

  async getText(): Promise<string> {
    return (await this.host()).text();
  }

  async getStatus(): Promise<string | null> {
    return (await this.host()).getAttribute('data-status');
  }

  async getRole(): Promise<string | null> {
    return (await this.host()).getAttribute('role');
  }
}
