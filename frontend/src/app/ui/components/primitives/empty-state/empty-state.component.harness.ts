import { ComponentHarness } from '@angular/cdk/testing';

export class EmptyStateComponentHarness extends ComponentHarness {
  static hostSelector = 'app-empty-state';

  private readonly _container = this.locatorFor('div');
  private readonly _titleEl = this.locatorForOptional('[data-testid="empty-state-title"]');
  private readonly _descriptionEl = this.locatorForOptional('[data-testid="empty-state-description"]');

  async getTitle(): Promise<string> {
    const el = await this._titleEl();
    return el ? el.text() : '';
  }

  async getDescription(): Promise<string> {
    const el = await this._descriptionEl();
    return el ? el.text() : '';
  }

  async isStatus(): Promise<boolean> {
    const container = await this._container();
    const role = await container.getAttribute('role');
    return role === 'status';
  }

  async getAriaLabel(): Promise<string | null> {
    const container = await this._container();
    return container.getAttribute('aria-label');
  }
}
