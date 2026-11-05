export class ConfirmationFocusManager {
  private trigger: HTMLElement | null = null;
  private fallback: HTMLElement | null = null;

  remember(event?: Event): void {
    const trigger = event?.currentTarget;
    this.trigger = trigger instanceof HTMLElement ? trigger : null;
    this.fallback =
      this.trigger?.closest<HTMLElement>(
        '[data-testid="guest-list-assignment-row"]',
      ) ?? null;
  }

  restore(preferFallback = false): void {
    const trigger = this.trigger;
    const fallback = this.fallback;
    this.trigger = null;
    this.fallback = null;
    queueMicrotask(() => {
      if (!preferFallback && trigger?.isConnected) {
        trigger.focus();
        return;
      }
      if (fallback?.isConnected) {
        fallback.focus();
        return;
      }
      trigger?.focus();
    });
  }
}
