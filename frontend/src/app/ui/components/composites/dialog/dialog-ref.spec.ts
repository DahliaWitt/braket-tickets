import type {OverlayRef} from '@angular/cdk/overlay';
import {Subject} from 'rxjs';
import {vi} from 'vitest';
import {BraDialogOptions, type OnClickCallback} from './dialog.component';
import {BraDialogRef} from './dialog-ref';

type PlatformId = 'browser' | 'server';

interface DialogContent {
  id: string;
}

interface TestOutput<T> {
  emit: (value: T) => void;
  subscribe: (callback: (value: T) => void) => {unsubscribe: () => void};
}

interface DialogContainerStub {
  cancelTriggered: TestOutput<void>;
  okTriggered: TestOutput<void>;
  getNativeElement: ReturnType<typeof vi.fn>;
}

interface OverlayStub {
  outsidePointerEvents: ReturnType<typeof vi.fn>;
  hasAttached: ReturnType<typeof vi.fn>;
  detachBackdrop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function createTestOutput<T>(): TestOutput<T> {
  const output$ = new Subject<T>();
  return {
    emit: (value: T) => output$.next(value),
    subscribe: (callback) => {
      const subscription = output$.subscribe(callback);
      return {unsubscribe: () => subscription.unsubscribe()};
    },
  };
}

const createDialogRefHarness = (
  platformId: PlatformId = 'browser',
  configOverrides: Partial<BraDialogOptions<DialogContent, unknown>> = {},
) => {
  const outsidePointerEvents$ = new Subject<PointerEvent>();
  const hostElement = document.createElement('div');
  const contentInstance: DialogContent = {id: 'content'};

  const container: DialogContainerStub = {
    cancelTriggered: createTestOutput<void>(),
    okTriggered: createTestOutput<void>(),
    getNativeElement: vi.fn(() => hostElement),
  };

  const overlayRef: OverlayStub = {
    outsidePointerEvents: vi.fn(() => outsidePointerEvents$.asObservable()),
    hasAttached: vi.fn(() => true),
    detachBackdrop: vi.fn(),
    dispose: vi.fn(),
  };

  const config: BraDialogOptions<DialogContent, unknown> = {
    ...new BraDialogOptions<DialogContent, unknown>(),
    ...configOverrides,
  };

  const dialogRef = new BraDialogRef<DialogContent, unknown, unknown>(
    overlayRef as unknown as OverlayRef,
    config,
    container as never,
    platformId as unknown as object,
  );

  dialogRef.componentInstance = contentInstance;

  return {
    dialogRef,
    overlayRef,
    container,
    outsidePointerEvents$,
    contentInstance,
    hostElement,
  };
};

describe('BraDialogRef', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should close from outside pointer events when mask is closable', async () => {
    vi.useFakeTimers();
    const harness = createDialogRefHarness('browser');

    harness.outsidePointerEvents$.next(new PointerEvent('pointerdown'));
    await vi.runAllTimersAsync();

    expect(harness.hostElement.classList.contains('dialog-leave')).toBe(true);
    expect(harness.overlayRef.detachBackdrop).toHaveBeenCalledTimes(1);
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should ignore outside pointer events when mask is not closable', async () => {
    vi.useFakeTimers();
    const harness = createDialogRefHarness('browser', {zMaskClosable: false});

    harness.outsidePointerEvents$.next(new PointerEvent('pointerdown'));
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();
  });

  it('should close on Escape key in browser mode', async () => {
    vi.useFakeTimers();
    const harness = createDialogRefHarness('browser');

    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should not register browser-only listeners on server platform', async () => {
    vi.useFakeTimers();
    const harness = createDialogRefHarness('server');

    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    harness.outsidePointerEvents$.next(new PointerEvent('pointerdown'));
    await vi.runAllTimersAsync();

    expect(harness.container.getNativeElement).not.toHaveBeenCalled();
    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();
  });

  it('should forward callback options with component instance', async () => {
    vi.useFakeTimers();
    const onOk = vi.fn(() => false as unknown as false | void | object);
    const onCancel = vi.fn(() => false as unknown as false | void | object);

    const harness = createDialogRefHarness('browser', {
      zOnOk: onOk as OnClickCallback<DialogContent>,
      zOnCancel: onCancel as OnClickCallback<DialogContent>,
    });

    harness.container.okTriggered.emit();
    harness.container.cancelTriggered.emit();
    await vi.runAllTimersAsync();

    expect(onOk).toHaveBeenCalledWith(harness.contentInstance);
    expect(onCancel).toHaveBeenCalledWith(harness.contentInstance);
    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();
  });

  it('should close with callback result and emit afterClosed value for ok trigger', async () => {
    vi.useFakeTimers();
    const result = {saved: true};
    const afterClosedValues: unknown[] = [];

    const harness = createDialogRefHarness('browser', {
      zOnOk: vi.fn(() => result),
    });

    harness.dialogRef.afterClosed$.subscribe((value) =>
      afterClosedValues.push(value),
    );

    harness.container.okTriggered.emit();
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
    expect(afterClosedValues).toEqual([result]);
  });

  it('should dispose after transitionend without waiting for the fallback timer', async () => {
    vi.useFakeTimers();
    const harness = createDialogRefHarness('browser');

    harness.dialogRef.close('done');
    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();

    harness.hostElement.dispatchEvent(new Event('transitionend'));
    await Promise.resolve();

    expect(harness.overlayRef.detachBackdrop).toHaveBeenCalledTimes(1);
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should ignore bubbled child transitionend events while closing', async () => {
    vi.useFakeTimers();
    const harness = createDialogRefHarness('browser');
    const childElement = document.createElement('button');
    harness.hostElement.appendChild(childElement);

    harness.dialogRef.close('done');
    childElement.dispatchEvent(new Event('transitionend', {bubbles: true}));
    await Promise.resolve();

    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();

    harness.hostElement.dispatchEvent(new Event('transitionend'));
    await Promise.resolve();

    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should keep dialog open when cancel callback returns false', async () => {
    vi.useFakeTimers();
    const harness = createDialogRefHarness('browser', {
      zOnCancel: vi.fn(() => false) as unknown as BraDialogOptions<
        DialogContent,
        unknown
      >['zOnCancel'],
    });

    harness.container.cancelTriggered.emit();
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();
  });

  it('should ignore repeated close calls and skip backdrop detachment when not attached', async () => {
    vi.useFakeTimers();
    const afterClosedValues: unknown[] = [];
    const harness = createDialogRefHarness('browser');
    harness.overlayRef.hasAttached.mockReturnValue(false);

    harness.dialogRef.afterClosed$.subscribe((value) =>
      afterClosedValues.push(value),
    );

    harness.dialogRef.close('first');
    harness.dialogRef.close('second');
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.detachBackdrop).not.toHaveBeenCalled();
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
    expect(afterClosedValues).toEqual(['first']);
  });
});
