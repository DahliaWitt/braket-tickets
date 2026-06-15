import {ComponentHarness} from '@angular/cdk/testing';

export class AppHarness extends ComponentHarness {
  static hostSelector = 'app-root';

  private readonly initialRouteShell = this.locatorForOptional(
    '[data-testid="initial-route-shell"]',
  );

  async isInitialRouteShellVisible(): Promise<boolean> {
    return (await this.initialRouteShell()) !== null;
  }
}
