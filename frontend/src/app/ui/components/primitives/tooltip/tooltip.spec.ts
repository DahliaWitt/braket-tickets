import { OverlayModule } from '@angular/cdk/overlay';
import { PortalModule } from '@angular/cdk/portal';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  type Renderer2,
  signal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { ZardTooltipDirective } from './tooltip';
import { type ZardTooltipPositionVariants } from './tooltip.variants';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      [zTooltip]="tooltip()"
      [zTrigger]="trigger()"
      [zPosition]="position()"
      [zShowDelay]="showDelay()"
      [zHideDelay]="hideDelay()"
      (zShow)="onShow()"
      (zHide)="onHide()"
    >
      Trigger
    </button>
  `,
  imports: [ZardTooltipDirective],
})
class TestHostComponent {
  readonly tooltip = signal<string | null>('Helpful details');
  readonly trigger = signal<'hover' | 'click'>('hover');
  readonly position = signal<ZardTooltipPositionVariants>('top');
  readonly showDelay = signal(0);
  readonly hideDelay = signal(0);

  readonly showCount = signal(0);
  readonly hideCount = signal(0);

  onShow(): void {
    this.showCount.update((count) => count + 1);
  }

  onHide(): void {
    this.hideCount.update((count) => count + 1);
  }
}

interface TooltipDirectiveTestApi {
  overlayRef?: {
    attach: () => TooltipComponentRefStub;
    detach: () => void;
    hasAttached: () => boolean;
    dispose: () => void;
    outsidePointerEvents: () => Subject<PointerEvent>;
  };
  componentRef?: TooltipComponentRefStub;
  listenersRefs: (() => void)[];
  renderer: Renderer2;
  show(): void;
  hide(): void;
  delay(isShow: boolean, delay?: number): void;
  setupDelayMechanism(): void;
  initClickListeners(): void;
  initHoverListeners(): void;
  initScrollListener(): void;
  cleanupTriggerEvents(): void;
}

interface TooltipComponentRefStub {
  instance: {
    setProps: (text: string, position: ZardTooltipPositionVariants, tooltipId?: string) => void;
    state: { set: (state: 'closed' | 'opened') => void };
  };
  onDestroy: (callback: () => void) => void;
}

describe('ZardTooltipDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;

  const getDirective = (): ZardTooltipDirective =>
    fixture.debugElement
      .query(By.directive(ZardTooltipDirective))
      .injector.get(ZardTooltipDirective);

  const getDirectiveApi = (): TooltipDirectiveTestApi =>
    getDirective() as unknown as TooltipDirectiveTestApi;

  const getTriggerButton = (): HTMLButtonElement =>
    fixture.debugElement.query(By.css('button')).nativeElement as HTMLButtonElement;

  const createOverlayStub = (
    hasAttached = false,
  ): {
    overlayRef: TooltipDirectiveTestApi['overlayRef'];
    componentRef: TooltipComponentRefStub;
    setPropsSpy: ReturnType<typeof vi.fn>;
    stateSetSpy: ReturnType<typeof vi.fn>;
    detachSpy: ReturnType<typeof vi.fn>;
  } => {
    const setPropsSpy = vi.fn();
    const stateSetSpy = vi.fn();
    const detachSpy = vi.fn();
    const onDestroyCallbacks: (() => void)[] = [];

    const componentRef: TooltipComponentRefStub = {
      instance: {
        setProps: setPropsSpy,
        state: { set: stateSetSpy },
      },
      onDestroy: (callback: () => void) => {
        onDestroyCallbacks.push(callback);
      },
    };

    const overlayRef = {
      attach: vi.fn(() => componentRef),
      detach: detachSpy,
      hasAttached: vi.fn(() => hasAttached),
      dispose: vi.fn(),
      outsidePointerEvents: vi.fn(() => new Subject<PointerEvent>()),
    };

    return { overlayRef, componentRef, setPropsSpy, stateSetSpy, detachSpy };
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, OverlayModule, PortalModule],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should show tooltip content and set aria-describedby', () => {
    host.tooltip.set('  Helpful details  ');
    host.position.set('right');
    fixture.detectChanges();

    const api = getDirectiveApi();
    const { overlayRef, setPropsSpy, stateSetSpy } = createOverlayStub();
    api.overlayRef = overlayRef;

    api.show();
    fixture.detectChanges();

    expect(overlayRef?.attach).toHaveBeenCalledTimes(1);
    expect(setPropsSpy).toHaveBeenCalledWith('Helpful details', 'right', expect.any(String));
    expect(stateSetSpy).toHaveBeenCalledWith('opened');

    const tooltipId = setPropsSpy.mock.calls[0]?.[2] as string;
    expect(getTriggerButton().getAttribute('aria-describedby')).toBe(tooltipId);
    expect(host.showCount()).toBe(1);
  });

  it('should hide tooltip, clear aria-describedby, and emit hide', () => {
    const api = getDirectiveApi();
    const { overlayRef, componentRef, stateSetSpy, detachSpy } = createOverlayStub();
    api.overlayRef = overlayRef;
    api.componentRef = componentRef;
    getTriggerButton().setAttribute('aria-describedby', 'z-tooltip-test');

    api.hide();
    fixture.detectChanges();

    expect(stateSetSpy).toHaveBeenCalledWith('closed');
    expect(detachSpy).toHaveBeenCalledTimes(1);
    expect(getTriggerButton().getAttribute('aria-describedby')).toBeNull();
    expect(host.hideCount()).toBe(1);
  });

  it('should not attach tooltip when content is empty', () => {
    host.tooltip.set('   ');
    fixture.detectChanges();

    const api = getDirectiveApi();
    const { overlayRef } = createOverlayStub();
    api.overlayRef = overlayRef;

    api.show();
    expect(overlayRef?.attach).not.toHaveBeenCalled();
    expect(host.showCount()).toBe(0);
  });

  it('should not attach tooltip when content is null', () => {
    host.tooltip.set(null);
    fixture.detectChanges();

    const api = getDirectiveApi();
    const { overlayRef } = createOverlayStub();
    api.overlayRef = overlayRef;

    api.show();
    expect(overlayRef?.attach).not.toHaveBeenCalled();
    expect(host.showCount()).toBe(0);
  });

  it('should process delayed show and hide with latest-event semantics', () => {
    vi.useFakeTimers();
    const api = getDirectiveApi();
    const showSpy = vi.spyOn(api, 'show');
    const hideSpy = vi.spyOn(api, 'hide');

    api.setupDelayMechanism();
    api.delay(true, 20);
    api.delay(false, 10);
    vi.advanceTimersByTime(10);

    expect(hideSpy).toHaveBeenCalledTimes(1);
    expect(showSpy).not.toHaveBeenCalled();

    api.delay(true, -1);
    expect(showSpy).toHaveBeenCalledTimes(1);
  });

  it('should initialize click trigger listener with correct delays', () => {
    host.trigger.set('click');
    host.showDelay.set(15);
    host.hideDelay.set(5);
    fixture.detectChanges();

    const api = getDirectiveApi();
    const { overlayRef } = createOverlayStub(false);
    const delaySpy = vi.spyOn(api, 'delay');
    api.overlayRef = overlayRef;

    let clickHandler: (() => void) | undefined;
    vi.spyOn(api.renderer, 'listen').mockImplementation((_, eventName, callback) => {
      if (eventName === 'click') {
        clickHandler = callback as () => void;
      }
      return vi.fn();
    });

    api.initClickListeners();
    clickHandler?.();
    expect(delaySpy).toHaveBeenCalledWith(true, 15);

    (overlayRef!.hasAttached as ReturnType<typeof vi.fn>).mockReturnValue(true);
    clickHandler?.();
    expect(delaySpy).toHaveBeenCalledWith(false, 5);
  });

  it('should initialize hover listeners for pointer and focus transitions', () => {
    host.trigger.set('hover');
    host.showDelay.set(30);
    host.hideDelay.set(12);
    fixture.detectChanges();

    const api = getDirectiveApi();
    const delaySpy = vi.spyOn(api, 'delay');
    const handlers: Record<string, () => void> = {};

    vi.spyOn(api.renderer, 'listen').mockImplementation((_, eventName, callback) => {
      handlers[eventName] = callback as () => void;
      return vi.fn();
    });

    api.initHoverListeners();
    handlers.mouseenter?.();
    handlers.focus?.();
    handlers.mouseleave?.();
    handlers.blur?.();

    expect(delaySpy).toHaveBeenCalledWith(true, 30);
    expect(delaySpy).toHaveBeenCalledWith(false, 12);
    expect(delaySpy).toHaveBeenCalledTimes(4);
  });

  it('should cleanup all registered listeners', () => {
    const api = getDirectiveApi();
    const stopOne = vi.fn();
    const stopTwo = vi.fn();
    api.listenersRefs = [stopOne, stopTwo];

    api.cleanupTriggerEvents();

    expect(stopOne).toHaveBeenCalledTimes(1);
    expect(stopTwo).toHaveBeenCalledTimes(1);
    expect(api.listenersRefs).toEqual([]);
  });

  it('should throttle scroll-triggered hide events', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-17T00:00:00.000Z'));
    const api = getDirectiveApi();
    const delaySpy = vi.spyOn(api, 'delay');
    let scrollHandler: (() => void) | undefined;

    vi.spyOn(api.renderer, 'listen').mockImplementation((_, eventName, callback) => {
      if (eventName === 'scroll') {
        scrollHandler = callback as () => void;
      }
      return vi.fn();
    });

    api.initScrollListener();
    expect(scrollHandler).toBeDefined();

    scrollHandler?.();

    // throttle() suppresses the immediate call and allows calls after wait has elapsed.
    expect(delaySpy).toHaveBeenCalledTimes(0);

    vi.setSystemTime(new Date('2026-02-17T00:00:00.150Z'));
    scrollHandler?.();
    expect(delaySpy).toHaveBeenCalledWith(false, 0);
    expect(delaySpy).toHaveBeenCalledTimes(1);

    scrollHandler?.();
    expect(delaySpy).toHaveBeenCalledTimes(1);
  });
});
