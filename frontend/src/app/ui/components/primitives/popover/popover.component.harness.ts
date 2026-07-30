import {ComponentHarness} from '@angular/cdk/testing';

export class PopoverTriggerHarness extends ComponentHarness {
  static hostSelector = 'button';

  async click(): Promise<void> {
    const host = await this.host();
    await host.click();
  }

  async keydown(key: string): Promise<void> {
    const host = await this.host();
    await host.dispatchEvent('keydown', {key});
  }

  async mouseEnter(): Promise<void> {
    const host = await this.host();
    await host.dispatchEvent('mouseenter');
  }

  async mouseLeave(): Promise<void> {
    const host = await this.host();
    await host.dispatchEvent('mouseleave');
  }

  async focus(): Promise<void> {
    const host = await this.host();
    await host.dispatchEvent('focus');
  }

  async blur(): Promise<void> {
    const host = await this.host();
    await host.dispatchEvent('blur');
  }
}

export class PopoverContentHarness extends ComponentHarness {
  static hostSelector = 'z-popover';

  async getText(): Promise<string> {
    const host = await this.host();
    return host.text();
  }

  /**
   * Simulates a real pointer interaction (pointerdown + click) originating from
   * inside the popover content. The CDK outside-click dispatcher treats these as
   * inside-overlay events and must NOT dismiss the popover.
   */
  async clickContent(): Promise<void> {
    const host = await this.host();
    await host.dispatchEvent('pointerdown');
    await host.dispatchEvent('click');
  }
}
