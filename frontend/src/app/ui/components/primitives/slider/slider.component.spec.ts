import {type HarnessLoader} from '@angular/cdk/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {By} from '@angular/platform-browser';
import {vi} from 'vitest';
import {ZardSliderComponent} from './slider.component';
import {ZardSliderHarness} from './slider.component.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-slider
      [zMin]="min()"
      [zMax]="max()"
      [zDefault]="defaultValue()"
      [zValue]="value()"
      [zStep]="step()"
      [zDisabled]="disabled()"
      [zOrientation]="orientation()"
      (zSlideIndexChange)="onSlide($event)"
    />
  `,
  imports: [ZardSliderComponent],
})
class TestHostComponent {
  readonly min = signal(0);
  readonly max = signal(100);
  readonly defaultValue = signal(0);
  readonly value = signal<number | null>(null);
  readonly step = signal(1);
  readonly disabled = signal(false);
  readonly orientation = signal<'horizontal' | 'vertical'>('horizontal');

  readonly slideChanges = signal<number[]>([]);

  onSlide(nextValue: number): void {
    this.slideChanges.update((changes) => [...changes, nextValue]);
  }
}

describe('ZardSliderComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let loader: HarnessLoader;

  const getSliderComponent = (): ZardSliderComponent =>
    fixture.debugElement.query(By.directive(ZardSliderComponent))
      .componentInstance as ZardSliderComponent;

  const mockSliderRect = (rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  }): void => {
    const sliderElement = fixture.debugElement.query(
      By.directive(ZardSliderComponent),
    ).nativeElement as HTMLElement;
    const domRect: DOMRect = {
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    };
    vi.spyOn(sliderElement, 'getBoundingClientRect').mockReturnValue(domRect);
  };

  const dispatchPointerEvent = (
    eventName: 'pointerdown' | 'pointermove' | 'pointerup',
    target: EventTarget,
    coordinates: {clientX?: number; clientY?: number} = {},
  ): void => {
    const event = new Event(eventName, {bubbles: true}) as PointerEvent;
    if (coordinates.clientX != null) {
      Object.defineProperty(event, 'clientX', {
        configurable: true,
        value: coordinates.clientX,
      });
    }
    if (coordinates.clientY != null) {
      Object.defineProperty(event, 'clientY', {
        configurable: true,
        value: coordinates.clientY,
      });
    }
    target.dispatchEvent(event);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize from zDefault when writeValue receives null', async () => {
    host.defaultValue.set(25);
    fixture.detectChanges();
    getSliderComponent().writeValue(null as unknown as number);

    const slider = await loader.getHarness(ZardSliderHarness);
    expect(await slider.getValue()).toBe(25);
  });

  it('should prefer zValue over zDefault when zValue is in range', async () => {
    host.defaultValue.set(10);
    host.value.set(60);
    fixture.detectChanges();

    const slider = await loader.getHarness(ZardSliderHarness);
    expect(await slider.getValue()).toBe(60);
  });

  it('should clamp and round values in writeValue', () => {
    host.step.set(10);
    fixture.detectChanges();

    const slider = getSliderComponent();
    slider.writeValue(26);
    expect(slider.lastEmittedValue()).toBe(30);
    expect(slider.percentValue()).toBe(30);

    slider.writeValue(1000);
    expect(slider.lastEmittedValue()).toBe(100);
    expect(slider.percentValue()).toBe(100);
  });

  it('should emit value changes from keyboard navigation keys', async () => {
    host.step.set(10);
    host.value.set(50);
    fixture.detectChanges();

    const slider = getSliderComponent();
    const onChange = vi.fn();
    slider.registerOnChange(onChange);

    slider.handleKeydown(new KeyboardEvent('keydown', {key: 'ArrowRight'}));
    slider.handleKeydown(new KeyboardEvent('keydown', {key: 'Home'}));
    slider.handleKeydown(new KeyboardEvent('keydown', {key: 'End'}));
    slider.handleKeydown(new KeyboardEvent('keydown', {key: 'Escape'}));
    fixture.detectChanges();

    expect(host.slideChanges()).toEqual([60, 0, 100]);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenNthCalledWith(1, 60);
    expect(onChange).toHaveBeenNthCalledWith(2, 0);
    expect(onChange).toHaveBeenNthCalledWith(3, 100);
  });

  it('should ignore keyboard input when disabled by input', async () => {
    host.value.set(40);
    host.disabled.set(true);
    fixture.detectChanges();

    getSliderComponent().handleKeydown(
      new KeyboardEvent('keydown', {key: 'ArrowRight'}),
    );
    fixture.detectChanges();

    const sliderHarness = await loader.getHarness(ZardSliderHarness);
    expect(await sliderHarness.getValue()).toBe(40);
    expect(host.slideChanges()).toEqual([]);
  });

  it('should reflect disabled state when setDisabledState is called', async () => {
    const slider = getSliderComponent();
    slider.setDisabledState(true);
    fixture.detectChanges();

    const sliderHarness = await loader.getHarness(ZardSliderHarness);
    expect(await sliderHarness.isDisabled()).toBe(true);
  });

  it('should update value from pointer interaction on track and touch callback', async () => {
    host.step.set(10);
    mockSliderRect({left: 0, top: 0, width: 200, height: 40});
    fixture.detectChanges();

    const slider = getSliderComponent();
    const onTouched = vi.fn();
    slider.registerOnTouched(onTouched);

    dispatchPointerEvent('pointerdown', slider.trackRef().nativeElement, {
      clientX: 100,
      clientY: 20,
    });
    fixture.detectChanges();

    expect(slider.lastEmittedValue()).toBe(50);
    expect(host.slideChanges()).toEqual([50]);
    expect(onTouched).toHaveBeenCalledTimes(1);
  });

  it('should continue updating during pointer drag until pointerup', async () => {
    host.step.set(10);
    mockSliderRect({left: 0, top: 0, width: 200, height: 40});
    fixture.detectChanges();

    const slider = getSliderComponent();
    dispatchPointerEvent('pointerdown', slider.trackRef().nativeElement, {
      clientX: 40,
      clientY: 20,
    });
    dispatchPointerEvent('pointermove', document, {clientX: 160, clientY: 20});
    dispatchPointerEvent('pointerup', document);
    fixture.detectChanges();

    expect(host.slideChanges()).toEqual([20, 80]);
  });

  describe('when the range is not a whole number of steps', () => {
    // (zMax - zMin) / zStep = 10 / 4 = 2.5, so rounding the top of the track
    // (raw = 10) lands on step index 3 → 12, which overshoots zMax (10) unless
    // the rounded value is clamped back into [zMin, zMax].
    it('clamps a pointer drag to zMax instead of emitting an above-max value', async () => {
      host.min.set(0);
      host.max.set(10);
      host.step.set(4);
      mockSliderRect({left: 0, top: 0, width: 200, height: 40});
      fixture.detectChanges();

      const slider = getSliderComponent();
      dispatchPointerEvent('pointerdown', slider.trackRef().nativeElement, {
        clientX: 40,
        clientY: 20,
      });
      // Drag past the right edge of the track (raw = zMax).
      dispatchPointerEvent('pointermove', document, {
        clientX: 260,
        clientY: 20,
      });
      dispatchPointerEvent('pointerup', document);
      fixture.detectChanges();

      const harness = await loader.getHarness(ZardSliderHarness);
      const value = await harness.getValue();
      const max = await harness.getMax();
      const min = await harness.getMin();

      expect(value).toBe(10); // zMax is reachable, not 12
      expect(value).toBeLessThanOrEqual(max);
      expect(value).toBeGreaterThanOrEqual(min);
      // Every emitted value stays within [zMin, zMax].
      for (const emitted of host.slideChanges()) {
        expect(emitted).toBeLessThanOrEqual(10);
        expect(emitted).toBeGreaterThanOrEqual(0);
      }
      // Thumb never renders past the end of the track (would be 120% pre-fix).
      expect(slider.percentValue()).toBeLessThanOrEqual(100);
    });

    it('clamps a track click at the far end to zMax', async () => {
      host.min.set(0);
      host.max.set(10);
      host.step.set(4);
      mockSliderRect({left: 0, top: 0, width: 200, height: 40});
      fixture.detectChanges();

      const slider = getSliderComponent();
      dispatchPointerEvent('pointerdown', slider.trackRef().nativeElement, {
        clientX: 200,
        clientY: 20,
      });
      fixture.detectChanges();

      const harness = await loader.getHarness(ZardSliderHarness);
      expect(await harness.getValue()).toBe(10);
      expect(host.slideChanges()).toEqual([10]);
      expect(slider.percentValue()).toBeLessThanOrEqual(100);
    });

    it('clamps rounded values in writeValue', () => {
      host.min.set(0);
      host.max.set(10);
      host.step.set(4);
      fixture.detectChanges();

      const slider = getSliderComponent();
      slider.writeValue(10);

      expect(slider.lastEmittedValue()).toBe(10); // not 12
      expect(slider.percentValue()).toBe(100); // not 120
    });

    it('keyboard stepping from an off-grid zMax snaps to the grid and stays in range', async () => {
      host.min.set(0);
      host.max.set(10);
      host.step.set(4); // grid {0, 4, 8}; zMax (10) is off-grid
      host.value.set(10);
      fixture.detectChanges();

      const slider = getSliderComponent();
      const harness = await loader.getHarness(ZardSliderHarness);

      // Thumb starts at zMax (10). ArrowLeft must snap to the nearest grid value
      // below the ceiling (8), matching native <input type=range> step-down —
      // never below zMin, never off-grid at 6.
      slider.handleKeydown(new KeyboardEvent('keydown', {key: 'ArrowLeft'}));
      fixture.detectChanges();
      expect(await harness.getValue()).toBe(8);

      // ArrowRight climbs back and clamps to zMax, which stays reachable.
      slider.handleKeydown(new KeyboardEvent('keydown', {key: 'ArrowRight'}));
      fixture.detectChanges();
      expect(await harness.getValue()).toBe(10);

      // Home/End reach the exact bounds.
      slider.handleKeydown(new KeyboardEvent('keydown', {key: 'Home'}));
      fixture.detectChanges();
      expect(await harness.getValue()).toBe(0);
      slider.handleKeydown(new KeyboardEvent('keydown', {key: 'End'}));
      fixture.detectChanges();
      expect(await harness.getValue()).toBe(10);

      for (const emitted of host.slideChanges()) {
        expect(emitted).toBeLessThanOrEqual(10);
        expect(emitted).toBeGreaterThanOrEqual(0);
      }
    });

    it('clamps a vertical drag to the top of the track to zMax', async () => {
      host.orientation.set('vertical');
      host.min.set(0);
      host.max.set(10);
      host.step.set(4);
      mockSliderRect({left: 0, top: 0, width: 40, height: 200});
      fixture.detectChanges();

      const slider = getSliderComponent();
      // clientY above the track top → percentage clamps to 1 (raw = zMax).
      dispatchPointerEvent('pointerdown', slider.trackRef().nativeElement, {
        clientX: 10,
        clientY: -20,
      });
      fixture.detectChanges();

      const harness = await loader.getHarness(ZardSliderHarness);
      expect(await harness.getValue()).toBe(10);
      expect(await harness.getValue()).toBeLessThanOrEqual(
        await harness.getMax(),
      );
      expect(slider.percentValue()).toBeLessThanOrEqual(100);
      expect(host.slideChanges()).toEqual([10]);
    });

    it('clamps to zMax for a fractional checkout range and respects zMin', async () => {
      // Sliding-scale checkout: price $25.50, min $10, step $1.
      // (25.5 - 10) / 1 = 15.5 → rounds to 26, above zMax without clamping.
      host.min.set(10);
      host.max.set(25.5);
      host.step.set(1);
      mockSliderRect({left: 0, top: 0, width: 200, height: 40});
      fixture.detectChanges();

      const slider = getSliderComponent();
      const harness = await loader.getHarness(ZardSliderHarness);

      // Far right → clamp to zMax (25.5), not 26.
      dispatchPointerEvent('pointerdown', slider.trackRef().nativeElement, {
        clientX: 200,
        clientY: 20,
      });
      fixture.detectChanges();
      expect(await harness.getValue()).toBe(25.5);
      expect(await harness.getValue()).toBeLessThanOrEqual(
        await harness.getMax(),
      );
      expect(slider.percentValue()).toBeLessThanOrEqual(100);

      // Far left → clamp to zMin (10).
      dispatchPointerEvent('pointerdown', slider.trackRef().nativeElement, {
        clientX: 0,
        clientY: 20,
      });
      fixture.detectChanges();
      expect(await harness.getValue()).toBe(10);
      expect(await harness.getValue()).toBeGreaterThanOrEqual(
        await harness.getMin(),
      );

      // End reaches the exact (off-grid) zMax — the checkout price ceiling.
      slider.handleKeydown(new KeyboardEvent('keydown', {key: 'End'}));
      fixture.detectChanges();
      expect(await harness.getValue()).toBe(25.5);

      for (const emitted of host.slideChanges()) {
        expect(emitted).toBeLessThanOrEqual(25.5);
        expect(emitted).toBeGreaterThanOrEqual(10);
      }
    });
  });

  it('should calculate vertical percentage from Y coordinate', async () => {
    host.orientation.set('vertical');
    host.step.set(5);
    mockSliderRect({left: 0, top: 0, width: 40, height: 200});
    fixture.detectChanges();

    const slider = getSliderComponent();
    dispatchPointerEvent('pointerdown', slider.trackRef().nativeElement, {
      clientX: 10,
      clientY: 150,
    });
    fixture.detectChanges();

    expect(host.slideChanges()).toEqual([25]);
  });
});
