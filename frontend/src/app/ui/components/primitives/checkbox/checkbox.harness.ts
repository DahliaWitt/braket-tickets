import {ComponentHarness} from '@angular/cdk/testing';

export class ZardCheckboxHarness extends ComponentHarness {
  static hostSelector = 'z-checkbox';

  private getInput = this.locatorFor('input[type="checkbox"]');
  private getLabelContainer = this.locatorFor('label');
  private getLabelTextElement = this.locatorFor('span');

  async isChecked(): Promise<boolean> {
    const input = await this.getInput();
    return input.getProperty<boolean>('checked');
  }

  async isDisabled(): Promise<boolean> {
    const input = await this.getInput();
    return input.getProperty<boolean>('disabled');
  }

  async toggle(): Promise<void> {
    const label = await this.getLabelContainer();
    return label.click();
  }

  async getLabelText(): Promise<string> {
    const labelText = await this.getLabelTextElement();
    return labelText.text();
  }

  /** Native `name` attribute of the underlying checkbox input. */
  async getInputName(): Promise<string | null> {
    const input = await this.getInput();
    return input.getAttribute('name');
  }
}
