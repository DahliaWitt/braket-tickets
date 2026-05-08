import type { OverlayRef } from '@angular/cdk/overlay';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { BraAlertDialogOptions } from './alert-dialog.component';
import { BraAlertDialogRef } from './alert-dialog-ref';

interface DialogContent {
  id: string;
}

interface TestOutput<T> {
  emit: (value: T) => void;
  subscribe: (callback: (value: T) => void) => { unsubscribe: () => void };
}

interface AlertDialogContainerStub {
  cancelTriggered: TestOutput<void>;
  okTriggered: TestOutput<void>;
  getNativeElement: ReturnType<typeof vi.fn>;
}

interface OverlayStub {
  outsidePointerEvents: ReturnType<typeof vi.fn>;
  keydownEvents: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function createTestOutput<T>(): TestOutput<T> {
  const output$ = new Subject<T>();
  return {
    emit: (value: T) => output$.next(value),
    subscribe: (callback) => {
      const subscription = output$.subscribe(callback);
      return { unsubscribe: () => subscription.unsubscribe() };
    },
  };
}

const createRefHarness = (
  configOverrides: Partial<BraAlertDialogOptions<DialogContent>> = {},
  getNativeElement: () => HTMLElement | null = () => document.createElement('div'),
) => {
  const outsidePointerEvents$ = new Subject<PointerEvent>();
  const keydownEvents$ = new Subject<KeyboardEvent>();

  const container: AlertDialogContainerStub = {
    cancelTriggered: createTestOutput<void>(),
    okTriggered: createTestOutput<void>(),
    getNativeElement: vi.fn(getNativeElement),
  };

  const overlayRef: OverlayStub = {
    outsidePointerEvents: vi.fn(() => outsidePointerEvents$.asObservable()),
    keydownEvents: vi.fn(() => keydownEvents$.asObservable()),
    dispose: vi.fn(),
  };

  const config: BraAlertDialogOptions<DialogContent> = {
    ...new BraAlertDialogOptions<DialogContent>(),
    ...configOverrides,
  };

  const dialogRef = new BraAlertDialogRef<DialogContent>(
    overlayRef as unknown as OverlayRef,
    config,
    container as never,
  );

  const componentInstance: DialogContent = { id: 'content' };
  dialogRef.componentInstance = componentInstance;

  return {
    dialogRef,
    container,
    overlayRef,
    outsidePointerEvents$,
    keydownEvents$,
    componentInstance,
  };
};

describe('BraAlertDialogRef', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should close from mask click when mask is closable', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    const harness = createRefHarness({}, () => host);

    harness.outsidePointerEvents$.next(new PointerEvent('pointerdown'));
    await vi.runAllTimersAsync();

    expect(host.classList.contains('alert-dialog-leave')).toBe(true);
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should ignore mask click when mask closable is false', async () => {
    vi.useFakeTimers();
    const harness = createRefHarness({ zMaskClosable: false });

    harness.outsidePointerEvents$.next(new PointerEvent('pointerdown'));
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();
  });

  it('should treat Escape as cancel and ignore other keys', async () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    const harness = createRefHarness({ zOnCancel: onCancel });

    harness.keydownEvents$.next(new KeyboardEvent('keydown', { key: 'Enter' }));
    await vi.runAllTimersAsync();
    expect(onCancel).not.toHaveBeenCalled();
    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();

    harness.keydownEvents$.next(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.runAllTimersAsync();
    expect(onCancel).toHaveBeenCalledWith(harness.componentInstance);
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should ignore cancel actions after ok has started closing', async () => {
    vi.useFakeTimers();
    const onOk = vi.fn();
    const onCancel = vi.fn();
    const harness = createRefHarness({ zOnOk: onOk, zOnCancel: onCancel });

    harness.container.okTriggered.emit();
    harness.keydownEvents$.next(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.runAllTimersAsync();

    expect(onOk).toHaveBeenCalledWith(harness.componentInstance);
    expect(onCancel).not.toHaveBeenCalled();
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should keep dialog open when ok callback returns false', async () => {
    vi.useFakeTimers();
    const onOk = vi.fn(() => false) as unknown as (
      instance: DialogContent,
    ) => false | void | object;
    const harness = createRefHarness({ zOnOk: onOk });

    harness.container.okTriggered.emit();
    await vi.runAllTimersAsync();

    expect(onOk).toHaveBeenCalledWith(harness.componentInstance);
    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();
  });

  it('should close dialog when cancel callback returns non-false result', async () => {
    vi.useFakeTimers();
    const onCancel = vi.fn(() => ({ done: true }));
    const harness = createRefHarness({ zOnCancel: onCancel });

    harness.container.cancelTriggered.emit();
    await vi.runAllTimersAsync();

    expect(onCancel).toHaveBeenCalledWith(harness.componentInstance);
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should close by default when callbacks are not functions', async () => {
    vi.useFakeTimers();
    const harness = createRefHarness({ zOnCancel: undefined, zOnOk: undefined });

    harness.container.cancelTriggered.emit();
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should not dispose more than once when close is called repeatedly', async () => {
    vi.useFakeTimers();
    const harness = createRefHarness();

    harness.dialogRef.close();
    harness.dialogRef.close();
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should fallback to timeout-based close when native element is unavailable', async () => {
    vi.useFakeTimers();
    const harness = createRefHarness({}, () => null);

    harness.dialogRef.close();
    await vi.runAllTimersAsync();

    expect(harness.container.getNativeElement).toHaveBeenCalledTimes(1);
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should swallow overlay dispose errors', async () => {
    vi.useFakeTimers();
    const harness = createRefHarness();
    harness.overlayRef.dispose.mockImplementation(() => {
      throw new Error('already disposed');
    });

    await expect(
      (async () => {
        harness.dialogRef.close();
        await vi.runAllTimersAsync();
      })(),
    ).resolves.toBeUndefined();
  });
});
