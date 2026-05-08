import { ComponentHarness } from '@angular/cdk/testing';

export class ConfirmationStateComponentHarness extends ComponentHarness {
  static hostSelector = 'app-confirmation-state';

  private getIconContainer = this.locatorFor('div.rounded-full');
  private getTitle = this.locatorFor('h2');
  private getDescription = this.locatorForOptional('p');
  private getLoadingIcon = this.locatorForOptional('z-icon[zType="loader-circle"]');
  private getSpinningIcon = this.locatorForOptional('z-icon.animate-spin');

  /** Returns the heading text. */
  async getTitleText(): Promise<string> {
    return (await (await this.getTitle()).text()).trim();
  }

  /** Returns the description paragraph text, or null if no description is present. */
  async getDescriptionText(): Promise<string | null> {
    const el = await this.getDescription();
    return el ? (await el.text()).trim() : null;
  }

  /** Returns true when the component is in loading state (spinner visible). */
  async isLoading(): Promise<boolean> {
    return (await this.getLoadingIcon()) !== null;
  }

  /**
   * Returns the variant reflected in the icon container's CSS classes.
   * Checks for the presence of bg-* variant tokens on the icon container.
   */
  async getVariantClass(): Promise<string> {
    const container = await this.getIconContainer();
    return (await container.getAttribute('class')) ?? '';
  }

  /** Returns true if the icon container has the success (bg-secondary/10) token applied. */
  async isSuccessVariant(): Promise<boolean> {
    const cls = await this.getVariantClass();
    return cls.includes('bg-secondary/10');
  }

  /** Returns true if the icon container has the error (bg-destructive/20) token applied. */
  async isErrorVariant(): Promise<boolean> {
    const cls = await this.getVariantClass();
    return cls.includes('bg-destructive/20');
  }

  /** Returns true if the icon container has the warning (bg-accent/20) token applied. */
  async isWarningVariant(): Promise<boolean> {
    const cls = await this.getVariantClass();
    return cls.includes('bg-accent/20');
  }

  /** Returns true if the icon container has the loading/info (bg-primary/20) token applied. */
  async isPrimaryVariant(): Promise<boolean> {
    const cls = await this.getVariantClass();
    return cls.includes('bg-primary/20');
  }

  /** Returns true if the loading spinner is animating (animate-pulse on the container). */
  async isAnimatingPulse(): Promise<boolean> {
    const cls = await this.getVariantClass();
    return cls.includes('animate-pulse');
  }
}
