/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion --
   These specs cast vi.fn mocks to the callback/return types the dialog API
   expects; tsconfig.spec.json requires the casts even though the lint config
   considers them redundant. */
import {Overlay, OverlayModule, type OverlayRef} from '@angular/cdk/overlay';
import {ComponentPortal, PortalModule} from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  provideZonelessChangeDetection,
} from '@angular/core';
import {TestBed} from '@angular/core/testing';
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
  keydownEvents: ReturnType<typeof vi.fn>;
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
  const keydownEvents$ = new Subject<KeyboardEvent>();
  const hostElement = document.createElement('div');
  const contentInstance: DialogContent = {id: 'content'};

  const container: DialogContainerStub = {
    cancelTriggered: createTestOutput<void>(),
    okTriggered: createTestOutput<void>(),
    getNativeElement: vi.fn(() => hostElement),
  };

  const overlayRef: OverlayStub = {
    outsidePointerEvents: vi.fn(() => outsidePointerEvents$.asObservable()),
    keydownEvents: vi.fn(() => keydownEvents$.asObservable()),
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
    keydownEvents$,
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

  it('should close on Escape delivered through the overlay keydown stream', async () => {
    vi.useFakeTimers();
    const harness = createDialogRefHarness('browser');

    harness.keydownEvents$.next(new KeyboardEvent('keydown', {key: 'Escape'}));
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.keydownEvents).toHaveBeenCalledTimes(1);
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should ignore non-Escape keys on the overlay keydown stream', async () => {
    vi.useFakeTimers();
    const harness = createDialogRefHarness('browser');

    harness.keydownEvents$.next(new KeyboardEvent('keydown', {key: 'Enter'}));
    harness.keydownEvents$.next(new KeyboardEvent('keydown', {key: 'a'}));
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();
  });

  it('should not close on a raw document Escape (no document-level listener)', async () => {
    // Regression: the dialog previously listened on `document` for keydown, so
    // an Escape anywhere — including inside an inner overlay or a lower stacked
    // dialog — closed it. It must now react only to its own overlay's stream.
    vi.useFakeTimers();
    const harness = createDialogRefHarness('browser');

    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
    await vi.runAllTimersAsync();

    expect(harness.overlayRef.dispose).not.toHaveBeenCalled();
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

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class OverlayBodyComponent {}

/**
 * Integration coverage using the real CDK OverlayKeyboardDispatcher, which
 * routes a document keydown to the topmost attached overlay only. These prove
 * the Escape-scoping fix end-to-end: a lone dialog closes, an inner overlay (an
 * open z-select dropdown) intercepts Escape so the dialog stays open, and only
 * the topmost of stacked dialogs closes.
 */
describe('BraDialogRef Escape scoping with real CDK overlays', () => {
  let overlay: Overlay;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OverlayModule, PortalModule, OverlayBodyComponent],
      providers: [
        provideZonelessChangeDetection(),
        {provide: PLATFORM_ID, useValue: 'browser'},
      ],
    });
    overlay = TestBed.inject(Overlay);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Attaching a portal registers the overlay with the keyboard dispatcher, so
  // `keydownEvents()` receives document keydowns while it is the topmost overlay.
  const openDialog = () => {
    const overlayRef = overlay.create({
      positionStrategy: overlay.position().global(),
      hasBackdrop: false,
    });
    overlayRef.attach(new ComponentPortal(OverlayBodyComponent));

    const hostElement = document.createElement('div');
    const container = {
      cancelTriggered: createTestOutput<void>(),
      okTriggered: createTestOutput<void>(),
      getNativeElement: () => hostElement,
    };

    const dialogRef = new BraDialogRef(
      overlayRef,
      new BraDialogOptions(),
      container as never,
      'browser' as unknown as object,
    );

    let closed = false;
    dialogRef.afterClosed$.subscribe(() => {
      closed = true;
    });

    return {
      dialogRef,
      overlayRef,
      isClosed: () => closed,
    };
  };

  // Opens a bare CDK overlay on top of the dialog, whose panel stops keydown
  // propagation on Escape — modelling the fixed z-select dropdown, which uses
  // `(keydown.{...}.prevent-with-stop)` so a consumed Escape never bubbles to
  // the CDK keyboard dispatcher on <body>.
  const openInnerSelectLikeOverlay = (): {
    ref: OverlayRef;
    panel: HTMLElement;
  } => {
    const innerRef = overlay.create({
      positionStrategy: overlay.position().global(),
      hasBackdrop: false,
    });
    innerRef.attach(new ComponentPortal(OverlayBodyComponent));

    const panel = document.createElement('div');
    panel.tabIndex = -1;
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    innerRef.overlayElement.appendChild(panel);
    return {ref: innerRef, panel};
  };

  // The CDK OverlayKeyboardDispatcher listens on <body>, so a realistic Escape
  // must bubble up to <body> to be routed to the topmost overlay.
  const dispatchEscapeFrom = (target: EventTarget) => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}),
    );
  };

  it('closes a single open dialog on Escape', async () => {
    vi.useFakeTimers();
    const dialog = openDialog();

    dispatchEscapeFrom(document.body);
    await vi.runAllTimersAsync();

    expect(dialog.isClosed()).toBe(true);

    dialog.overlayRef.dispose();
  });

  it('does not close the dialog when an inner select dropdown consumes Escape', async () => {
    vi.useFakeTimers();
    const dialog = openDialog();
    const inner = openInnerSelectLikeOverlay();

    // Escape originates inside the open dropdown; the dropdown consumes it and
    // stops propagation, so it never reaches the dialog's overlay.
    dispatchEscapeFrom(inner.panel);
    await vi.runAllTimersAsync();

    expect(dialog.isClosed()).toBe(false);

    inner.ref.dispose();
    dialog.overlayRef.dispose();
  });

  it('closes only the topmost of stacked dialogs on Escape', async () => {
    vi.useFakeTimers();
    const lower = openDialog();
    const upper = openDialog();

    dispatchEscapeFrom(document.body);
    await vi.runAllTimersAsync();

    expect(upper.isClosed()).toBe(true);
    expect(lower.isClosed()).toBe(false);

    // A second Escape now reaches the previously-lower dialog, which is topmost.
    dispatchEscapeFrom(document.body);
    await vi.runAllTimersAsync();

    expect(lower.isClosed()).toBe(true);

    lower.overlayRef.dispose();
    upper.overlayRef.dispose();
  });
});
