import { ComponentHarness } from '@angular/cdk/testing';

export class AppStripePaymentHarness extends ComponentHarness {
  static hostSelector = 'app-stripe-payment';

  private _payButton = this.locatorForOptional('[data-testid="stripe-pay-button"]');
  private _error = this.locatorForOptional('[data-testid="stripe-payment-error"]');
  private _paymentElement = this.locatorForOptional('[data-testid="stripe-payment-element"]');

  getPayButton() {
    return this._payButton();
  }

  async clickPay(): Promise<void> {
    const btn = await this._payButton();
    if (btn) {
      await btn.click();
    }
  }

  async isLoading(): Promise<boolean> {
    const btn = await this._payButton();
    if (!btn) return false;
    const text = await btn.text();
    return text.includes('PROCESSING');
  }

  async isReady(): Promise<boolean> {
    const btn = await this._payButton();
    return btn !== null && !(await btn.getAttribute('disabled'));
  }

  async getErrorText(): Promise<string | null> {
    const err = await this._error();
    if (!err) return null;
    return (await err.text()).trim();
  }

  async isPaymentElementVisible(): Promise<boolean> {
    const el = await this._paymentElement();
    if (!el) return false;
    const className = (await el.getAttribute('class')) ?? '';
    return !className.includes('hidden');
  }

  async getPayButtonText(): Promise<string | null> {
    const btn = await this._payButton();
    if (!btn) return null;
    return btn.text();
  }
}
