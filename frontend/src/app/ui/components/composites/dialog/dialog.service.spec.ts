import {Overlay, OverlayModule, type OverlayRef} from '@angular/cdk/overlay';
import {PortalModule} from '@angular/cdk/portal';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import type {ComponentRef, EmbeddedViewRef, TemplateRef} from '@angular/core';
import {
  ChangeDetectionStrategy,
  Component,
  PLATFORM_ID,
  inject,
  provideZonelessChangeDetection,
  viewChild,
} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {Subject} from 'rxjs';
import {vi} from 'vitest';
import {BraDialogDocumentInertManager} from '../dialog-core/dialog-document-inert-manager';
import {type BraDialogOptions} from './dialog.component';
import {BraDialogHarness} from './dialog.component.harness';
import {BraDialogService} from './dialog.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-template #contentTemplate let-dialogRef="dialogRef"
    >Template Body</ng-template
  >`,
})
class TemplateHostComponent {
  readonly contentTemplate =
    viewChild.required<TemplateRef<unknown>>('contentTemplate');
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class DummyDialogContentComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" data-testid="background-control">
    Background
  </button>`,
})
class DialogServiceHostComponent {
  readonly dialogService = inject(BraDialogService);
}

interface TestOutput<T> {
  emit: (value: T) => void;
  subscribe: (callback: (value: T) => void) => {unsubscribe: () => void};
}

interface DialogContainerStub {
  cancelTriggered: TestOutput<void>;
  okTriggered: TestOutput<void>;
  attachComponentPortal: ReturnType<typeof vi.fn>;
  attachTemplatePortal: ReturnType<typeof vi.fn>;
  getNativeElement: ReturnType<typeof vi.fn>;
  dialogRef?: unknown;
}

interface OverlayStub {
  outsidePointerEvents: ReturnType<typeof vi.fn>;
  keydownEvents: ReturnType<typeof vi.fn>;
  hasAttached: ReturnType<typeof vi.fn>;
  detachBackdrop: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
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

function mockFocusableElementGeometry(): void {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
}

const createDialogHarness = () => {
  const outsidePointerEvents$ = new Subject<PointerEvent>();
  const keydownEvents$ = new Subject<KeyboardEvent>();
  const contentInstance = {id: 'content-instance'};

  const dialogContainer: DialogContainerStub = {
    cancelTriggered: createTestOutput<void>(),
    okTriggered: createTestOutput<void>(),
    attachComponentPortal: vi.fn(
      () =>
        ({
          instance: contentInstance,
        }) as unknown as ComponentRef<unknown>,
    ),
    attachTemplatePortal: vi.fn(
      () =>
        ({
          destroy: () => undefined,
        }) as unknown as EmbeddedViewRef<unknown>,
    ),
    getNativeElement: vi.fn(() => document.createElement('div')),
  };

  const overlayRef: OverlayStub = {
    outsidePointerEvents: vi.fn(() => outsidePointerEvents$.asObservable()),
    keydownEvents: vi.fn(() => keydownEvents$.asObservable()),
    hasAttached: vi.fn(() => true),
    detachBackdrop: vi.fn(),
    dispose: vi.fn(),
    attach: vi.fn(() => ({instance: dialogContainer})),
  };

  const globalPositionSpy = vi.fn(() => ({strategy: 'global'}));
  const overlay = {
    create: vi.fn(() => overlayRef as unknown as OverlayRef),
    position: vi.fn(() => ({global: globalPositionSpy})),
  } as unknown as Overlay;

  return {
    overlay,
    overlayRef,
    dialogContainer,
    contentInstance,
    globalPositionSpy,
  };
};

describe('BraDialogService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should attach component content and expose componentInstance on dialogRef', () => {
    vi.useFakeTimers();
    const harness = createDialogHarness();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BraDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'browser'},
      ],
    });

    const service = TestBed.inject(BraDialogService);
    const config: BraDialogOptions<
      DummyDialogContentComponent,
      {source: string}
    > = {
      zContent: DummyDialogContentComponent,
      zData: {source: 'component'},
    };

    const dialogRef = service.create(config);

    expect(harness.overlay.create).toHaveBeenCalledTimes(1);
    expect(harness.globalPositionSpy).toHaveBeenCalledTimes(1);
    expect(harness.overlayRef.attach).toHaveBeenCalledTimes(1);
    expect(harness.dialogContainer.attachComponentPortal).toHaveBeenCalledTimes(
      1,
    );
    expect(dialogRef.componentInstance).toBe(harness.contentInstance);

    dialogRef.close();
    vi.runAllTimers();
  });

  it('should attach template content when zContent is a TemplateRef', () => {
    vi.useFakeTimers();
    const harness = createDialogHarness();

    TestBed.configureTestingModule({
      imports: [TemplateHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        BraDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'browser'},
      ],
    });

    const fixture: ComponentFixture<TemplateHostComponent> =
      TestBed.createComponent(TemplateHostComponent);
    fixture.detectChanges();

    const service = TestBed.inject(BraDialogService);
    const config: BraDialogOptions<unknown, unknown> = {
      zContent: fixture.componentInstance.contentTemplate(),
    };

    const dialogRef = service.create(config);

    expect(harness.dialogContainer.attachTemplatePortal).toHaveBeenCalledTimes(
      1,
    );
    expect(
      harness.dialogContainer.attachComponentPortal,
    ).not.toHaveBeenCalled();
    expect(dialogRef.componentInstance).toBeNull();

    dialogRef.close();
    vi.runAllTimers();
  });

  it('should skip portal attachment when zContent is a string', () => {
    vi.useFakeTimers();
    const harness = createDialogHarness();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BraDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'browser'},
      ],
    });

    const service = TestBed.inject(BraDialogService);
    const config: BraDialogOptions<unknown, unknown> = {
      zContent: 'Hello dialog',
    };

    const dialogRef = service.create(config);

    expect(harness.dialogContainer.attachTemplatePortal).not.toHaveBeenCalled();
    expect(
      harness.dialogContainer.attachComponentPortal,
    ).not.toHaveBeenCalled();
    expect(dialogRef.componentInstance).toBeNull();

    dialogRef.close();
    vi.runAllTimers();
  });

  it('should create a safe no-op dialog ref on non-browser platform', () => {
    vi.useFakeTimers();
    const harness = createDialogHarness();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BraDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'server'},
      ],
    });

    const service = TestBed.inject(BraDialogService);
    const config: BraDialogOptions<unknown, unknown> = {
      zContent: 'Server dialog',
    };

    const dialogRef = service.create(config);

    expect(harness.overlay.create).not.toHaveBeenCalled();
    expect(() => dialogRef.close('done')).not.toThrow();
    vi.runAllTimers();
  });

  it('should release document inert and dispose overlay when content attachment throws', () => {
    const harness = createDialogHarness();
    const releaseDocumentInert = vi.fn();
    const inertManager = {
      activate: vi.fn(() => releaseDocumentInert),
    };
    harness.dialogContainer.attachComponentPortal.mockImplementation(() => {
      throw new Error('content attach failed');
    });
    harness.overlayRef.dispose.mockImplementation(() => {
      throw new Error('overlay dispose failed');
    });

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BraDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'browser'},
        {provide: BraDialogDocumentInertManager, useValue: inertManager},
      ],
    });

    const service = TestBed.inject(BraDialogService);

    expect(() =>
      service.create({
        zContent: DummyDialogContentComponent,
      }),
    ).toThrow('content attach failed');
    expect(inertManager.activate).toHaveBeenCalledTimes(1);
    expect(releaseDocumentInert).toHaveBeenCalledTimes(1);
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should move focus into the dialog and wrap focus at trap boundaries', async () => {
    mockFocusableElementGeometry();

    await TestBed.configureTestingModule({
      imports: [DialogServiceHostComponent, OverlayModule, PortalModule],
      providers: [provideZonelessChangeDetection(), BraDialogService],
    }).compileComponents();

    const fixture = TestBed.createComponent(DialogServiceHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const backgroundControl = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('[data-testid="background-control"]');
    if (!backgroundControl) {
      throw new Error('Background control not found');
    }
    backgroundControl.focus();

    const dialogRef = fixture.componentInstance.dialogService.create({
      zTitle: 'Delete event',
      zContent: 'This action cannot be undone.',
      zOkText: 'Delete',
    });

    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    const dialog = await loader.getHarness(BraDialogHarness);

    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).getAttribute('inert')).toBe(
      '',
    );
    await expect.poll(() => dialog.isCancelFocused()).toBe(true);

    await dialog.focusEndTrapAnchor();
    await fixture.whenStable();
    await expect.poll(() => dialog.isHeaderCloseFocused()).toBe(true);

    await dialog.focusStartTrapAnchor();
    await fixture.whenStable();
    await expect.poll(() => dialog.isOkFocused()).toBe(true);

    const host = document.querySelector<HTMLElement>('bra-dialog');
    dialogRef.close();
    host?.dispatchEvent(new Event('transitionend'));
    await fixture.whenStable();
    await expect.poll(() => document.activeElement).toBe(backgroundControl);
    expect(
      (fixture.nativeElement as HTMLElement).getAttribute('inert'),
    ).toBeNull();
  });

  it('should focus a fallback target when the dialog has no built-in focusable controls', async () => {
    mockFocusableElementGeometry();

    await TestBed.configureTestingModule({
      imports: [DialogServiceHostComponent, OverlayModule, PortalModule],
      providers: [provideZonelessChangeDetection(), BraDialogService],
    }).compileComponents();

    const fixture = TestBed.createComponent(DialogServiceHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const backgroundControl = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('[data-testid="background-control"]');
    if (!backgroundControl) {
      throw new Error('Background control not found');
    }
    backgroundControl.focus();

    const dialogRef = fixture.componentInstance.dialogService.create({
      zTitle: 'Read this',
      zContent: 'A dialog with no built-in actions still needs a focus target.',
      zHideFooter: true,
      zClosable: false,
    });

    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    const dialog = await loader.getHarness(BraDialogHarness);

    await fixture.whenStable();

    expect(await dialog.isFallbackInitialFocus()).toBe(true);
    await expect.poll(() => dialog.isFallbackFocused()).toBe(true);

    const host = document.querySelector<HTMLElement>('bra-dialog');
    dialogRef.close();
    host?.dispatchEvent(new Event('transitionend'));
    await fixture.whenStable();
  });
});
