import { ComponentHarness } from '@angular/cdk/testing';

export class ZardFormFieldHarness extends ComponentHarness {
  static hostSelector = 'z-form-field, [z-form-field]';

  async getText(): Promise<string> {
    return (await this.host()).text();
  }
}

export class ZardFormLabelHarness extends ComponentHarness {
  static hostSelector = 'z-form-label, label[z-form-label]';

  async getText(): Promise<string> {
    return (await this.host()).text();
  }

  async isRequired(): Promise<boolean> {
    return (await (await this.host()).getAttribute('data-required')) !== null;
  }
}

export class ZardFormMessageHarness extends ComponentHarness {
  static hostSelector = 'z-form-message, [z-form-message]';

  async getText(): Promise<string> {
    return (await this.host()).text();
  }

  async getType(): Promise<string | null> {
    return (await this.host()).getAttribute('data-type');
  }
}
