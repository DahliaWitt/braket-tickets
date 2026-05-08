export class MockWebHaptics {
  trigger(): Promise<void> {
    return Promise.resolve();
  }

  cancel(): void {
    return undefined;
  }

  destroy(): void {
    return undefined;
  }

  setDebug(): void {
    return undefined;
  }

  setShowSwitch(): void {
    return undefined;
  }
}
