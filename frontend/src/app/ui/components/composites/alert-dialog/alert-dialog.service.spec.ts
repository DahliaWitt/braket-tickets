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
import {type BraAlertDialogOptions} from './alert-dialog.component';
import {BraAlertDialogComponentHarness} from './alert-dialog.component.harness';
import {BraAlertDialogService} from './alert-dialog.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-template #contentTemplate let-alertDialogRef="alertDialogRef"
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
class DummyAlertDialogContentComponent {}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" data-testid="background-control">
    Background
  </button>`,
})
class AlertDialogServiceHostComponent {
  readonly alertDialogService = inject(BraAlertDialogService);
}

interface TestOutput<T> {
  emit: (value: T) => void;
  subscribe: (callback: (value: T) => void) => {unsubscribe: () => void};
}

interface AlertDialogContainerStub {
  cancelTriggered: TestOutput<void>;
  okTriggered: TestOutput<void>;
  attachComponentPortal: ReturnType<typeof vi.fn>;
  attachTemplatePortal: ReturnType<typeof vi.fn>;
  getNativeElement: ReturnType<typeof vi.fn>;
  alertDialogRef?: unknown;
}

interface OverlayStub {
  outsidePointerEvents: ReturnType<typeof vi.fn>;
  keydownEvents: ReturnType<typeof vi.fn>;
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

const createServiceHarness = () => {
  const outsidePointerEvents$ = new Subject<PointerEvent>();
  const keydownEvents$ = new Subject<KeyboardEvent>();
  const contentInstance = {id: 'alert-content-instance'};

  const alertDialogContainer: AlertDialogContainerStub = {
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
    dispose: vi.fn(),
    attach: vi.fn(() => ({instance: alertDialogContainer})),
  };

  const globalPositionSpy = vi.fn(() => ({strategy: 'global'}));
  const overlay = {
    create: vi.fn(() => overlayRef as unknown as OverlayRef),
    position: vi.fn(() => ({global: globalPositionSpy})),
  } as unknown as Overlay;

  return {
    overlay,
    overlayRef,
    alertDialogContainer,
    contentInstance,
    globalPositionSpy,
  };
};

describe('BraAlertDialogService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should attach component content and expose componentInstance on alertDialogRef', () => {
    vi.useFakeTimers();
    const harness = createServiceHarness();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BraAlertDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'browser'},
      ],
    });

    const service = TestBed.inject(BraAlertDialogService);
    const config: BraAlertDialogOptions<DummyAlertDialogContentComponent> = {
      zContent: DummyAlertDialogContentComponent,
      zData: {source: 'component'},
    };

    const alertDialogRef = service.create(config);

    expect(harness.overlay.create).toHaveBeenCalledTimes(1);
    expect(harness.globalPositionSpy).toHaveBeenCalledTimes(1);
    expect(harness.overlayRef.attach).toHaveBeenCalledTimes(1);
    expect(
      harness.alertDialogContainer.attachComponentPortal,
    ).toHaveBeenCalledTimes(1);
    expect(alertDialogRef.componentInstance).toBe(harness.contentInstance);

    alertDialogRef.close();
    vi.runAllTimers();
  });

  it('should attach template content when zContent is a TemplateRef', async () => {
    vi.useFakeTimers();
    const harness = createServiceHarness();

    TestBed.configureTestingModule({
      imports: [TemplateHostComponent],
      providers: [
        provideZonelessChangeDetection(),
        BraAlertDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'browser'},
      ],
    });

    const fixture: ComponentFixture<TemplateHostComponent> =
      TestBed.createComponent(TemplateHostComponent);
    fixture.detectChanges();

    const service = TestBed.inject(BraAlertDialogService);
    const config: BraAlertDialogOptions<unknown> = {
      zContent: fixture.componentInstance.contentTemplate(),
    };

    const alertDialogRef = service.create(config);

    expect(
      harness.alertDialogContainer.attachTemplatePortal,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.alertDialogContainer.attachComponentPortal,
    ).not.toHaveBeenCalled();
    expect(alertDialogRef.componentInstance).toBeUndefined();

    alertDialogRef.close();
    vi.runAllTimers();
  });

  it('should skip portal attachment when zContent is a string', () => {
    vi.useFakeTimers();
    const harness = createServiceHarness();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BraAlertDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'browser'},
      ],
    });

    const service = TestBed.inject(BraAlertDialogService);
    const config: BraAlertDialogOptions<unknown> = {
      zContent: 'Alert body',
    };

    const alertDialogRef = service.create(config);

    expect(
      harness.alertDialogContainer.attachTemplatePortal,
    ).not.toHaveBeenCalled();
    expect(
      harness.alertDialogContainer.attachComponentPortal,
    ).not.toHaveBeenCalled();
    expect(alertDialogRef.componentInstance).toBeUndefined();

    alertDialogRef.close();
    vi.runAllTimers();
  });

  it('should create a safe no-op alert dialog ref on non-browser platform', () => {
    vi.useFakeTimers();
    const harness = createServiceHarness();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BraAlertDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'server'},
      ],
    });

    const service = TestBed.inject(BraAlertDialogService);
    const config: BraAlertDialogOptions<unknown> = {
      zContent: 'Server alert',
    };

    const alertDialogRef = service.create(config);

    expect(harness.overlay.create).not.toHaveBeenCalled();
    expect(() => {
      alertDialogRef.close();
      vi.runAllTimers();
    }).not.toThrow();
  });

  it('should apply defaults in confirm/warning/info helpers', () => {
    const harness = createServiceHarness();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BraAlertDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'browser'},
      ],
    });

    const service = TestBed.inject(BraAlertDialogService);
    const createSpy = vi.spyOn(service, 'create').mockReturnValue({} as never);

    service.confirm({zTitle: 'Confirm'});
    expect(createSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        zOkText: 'Confirm',
        zCancelText: 'Cancel',
        zOkDestructive: false,
      }),
    );

    service.warning({zTitle: 'Warning'});
    expect(createSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        zOkText: 'OK',
        zCancelText: null,
      }),
    );

    service.info({zTitle: 'Info'});
    expect(createSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        zOkText: 'OK',
        zCancelText: null,
      }),
    );
  });

  it('should release document inert and dispose overlay when content attachment throws', () => {
    const harness = createServiceHarness();
    const releaseDocumentInert = vi.fn();
    const inertManager = {
      activate: vi.fn(() => releaseDocumentInert),
    };
    harness.alertDialogContainer.attachComponentPortal.mockImplementation(
      () => {
        throw new Error('alert content attach failed');
      },
    );
    harness.overlayRef.dispose.mockImplementation(() => {
      throw new Error('overlay dispose failed');
    });

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BraAlertDialogService,
        {provide: Overlay, useValue: harness.overlay},
        {provide: PLATFORM_ID, useValue: 'browser'},
        {provide: BraDialogDocumentInertManager, useValue: inertManager},
      ],
    });

    const service = TestBed.inject(BraAlertDialogService);

    expect(() =>
      service.create({
        zContent: DummyAlertDialogContentComponent,
      }),
    ).toThrow('alert content attach failed');
    expect(inertManager.activate).toHaveBeenCalledTimes(1);
    expect(releaseDocumentInert).toHaveBeenCalledTimes(1);
    expect(harness.overlayRef.dispose).toHaveBeenCalledTimes(1);
  });

  it('should move focus into the alert dialog and wrap focus at trap boundaries', async () => {
    mockFocusableElementGeometry();

    await TestBed.configureTestingModule({
      imports: [AlertDialogServiceHostComponent, OverlayModule, PortalModule],
      providers: [provideZonelessChangeDetection(), BraAlertDialogService],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlertDialogServiceHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const backgroundControl = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('[data-testid="background-control"]');
    if (!backgroundControl) {
      throw new Error('Background control not found');
    }
    backgroundControl.focus();

    const alertDialogRef = fixture.componentInstance.alertDialogService.confirm(
      {
        zTitle: 'Delete event',
        zContent: 'This action cannot be undone.',
        zOkText: 'Delete',
      },
    );

    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    const dialog = await loader.getHarness(BraAlertDialogComponentHarness);

    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).getAttribute('inert')).toBe(
      '',
    );
    await expect.poll(() => dialog.isCancelFocused()).toBe(true);

    await dialog.focusEndTrapAnchor();
    await fixture.whenStable();
    await expect.poll(() => dialog.isCancelFocused()).toBe(true);

    await dialog.focusStartTrapAnchor();
    await fixture.whenStable();
    await expect.poll(() => dialog.isOkFocused()).toBe(true);

    const host = document.querySelector<HTMLElement>('bra-alert-dialog');
    alertDialogRef.close();
    host?.dispatchEvent(new Event('transitionend'));
    await fixture.whenStable();
    await expect.poll(() => document.activeElement).toBe(backgroundControl);
    expect(
      (fixture.nativeElement as HTMLElement).getAttribute('inert'),
    ).toBeNull();
  });

  it('should focus a fallback target when the alert dialog has no built-in focusable controls', async () => {
    mockFocusableElementGeometry();

    await TestBed.configureTestingModule({
      imports: [AlertDialogServiceHostComponent, OverlayModule, PortalModule],
      providers: [provideZonelessChangeDetection(), BraAlertDialogService],
    }).compileComponents();

    const fixture = TestBed.createComponent(AlertDialogServiceHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const backgroundControl = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('[data-testid="background-control"]');
    if (!backgroundControl) {
      throw new Error('Background control not found');
    }
    backgroundControl.focus();

    const alertDialogRef = fixture.componentInstance.alertDialogService.create({
      zTitle: 'Read this',
      zContent: 'An alert dialog with no actions still needs a focus target.',
      zCancelText: null,
      zOkText: null,
    });

    const loader = TestbedHarnessEnvironment.documentRootLoader(fixture);
    const dialog = await loader.getHarness(BraAlertDialogComponentHarness);

    await fixture.whenStable();

    expect(await dialog.isFallbackInitialFocus()).toBe(true);
    await expect.poll(() => dialog.isFallbackFocused()).toBe(true);

    const host = document.querySelector<HTMLElement>('bra-alert-dialog');
    alertDialogRef.close();
    host?.dispatchEvent(new Event('transitionend'));
    await fixture.whenStable();
  });
});
