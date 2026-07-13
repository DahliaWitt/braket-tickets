import {ComponentHarness} from '@angular/cdk/testing';

/**
 * Harness for a `[zTooltip]` trigger element. The directive is applied via a
 * property binding (`[zTooltip]="..."`), so it leaves no attribute in the DOM
 * to key a `hostSelector` on. Following {@link PopoverTriggerHarness}, this
 * targets the trigger `button` and exposes the affordances (e.g. the
 * pointer-cursor host binding) as a stable API instead of raw DOM/style reads.
 */
export class ZardTooltipTriggerHarness extends ComponentHarness {
  static hostSelector = 'button';

  /** Inline `cursor` value on the trigger element (`''` when unset). */
  async getCursor(): Promise<string> {
    const style = await (
      await this.host()
    ).getProperty<CSSStyleDeclaration>('style');
    return style.cursor;
  }

  /** Whether the trigger opts into a pointer cursor. */
  async hasPointerCursor(): Promise<boolean> {
    return (await this.getCursor()) === 'pointer';
  }
}
