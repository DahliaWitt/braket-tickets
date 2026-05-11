import {ComponentHarness} from '@angular/cdk/testing';
import {waitForHarnessCondition} from '@/testing/harness-wait';

export class BraToastHarness extends ComponentHarness {
  static hostSelector = 'bra-toast, bra-toaster';

  protected getToasts = this.documentRootLocatorFactory().locatorForOptional(
    'li[data-sonner-toast]',
  );
  protected getToastTitle =
    this.documentRootLocatorFactory().locatorForOptional(
      '[data-sonner-toast] [data-title]',
    );
  protected getToastDescription =
    this.documentRootLocatorFactory().locatorForOptional(
      '[data-sonner-toast] [data-description]',
    );

  async hasToast(): Promise<boolean> {
    const toast = await this.getToasts();
    return toast !== null;
  }

  async getToastText(): Promise<string | null> {
    const title = await this.getToastTitle();
    const description = await this.getToastDescription();

    let text = '';
    if (title) {
      text += await title.text();
    }
    if (description) {
      text += (text ? ' ' : '') + (await description.text());
    }
    return text || null;
  }

  async hasToastWithText(text: string | RegExp): Promise<boolean> {
    const toastElement = await this.getToasts();
    if (!toastElement) return false;

    const toastText = await toastElement.text();
    if (typeof text === 'string') {
      return toastText.includes(text);
    }
    return text.test(toastText);
  }

  async waitForToastHidden(timeout = 5000): Promise<void> {
    await waitForHarnessCondition(
      async () => (await this.getToasts()) === null,
      {
        description: 'toast to be hidden',
        timeoutMs: timeout,
      },
    );
  }
}
