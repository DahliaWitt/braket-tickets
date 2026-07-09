import { type HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { ZardSliderComponent } from './slider.component';
import { ZardSliderHarness } from './slider.component.harness';

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
    const sliderElement = fixture.debugElement.query(By.directive(ZardSliderComponent))
      .nativeElement as HTMLElement;
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
    coordinates: { clientX?: number; clientY?: number } = {},
  ): void => {
    const event = new Event(eventName, { bubbles: true }) as PointerEvent;
    if (coordinates.clientX != null) {
      Object.defineProperty(event, 'clientX', { configurable: true, value: coordinates.clientX });
    }
    if (coordinates.clientY != null) {
      Object.defineProperty(event, 'clientY', { configurable: true, value: coordinates.clientY });
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

    slider.handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    slider.handleKeydown(new KeyboardEvent('keydown', { key: 'Home' }));
    slider.handleKeydown(new KeyboardEvent('keydown', { key: 'End' }));
    slider.handleKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
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

    getSliderComponent().handleKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
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
    mockSliderRect({ left: 0, top: 0, width: 200, height: 40 });
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
    mockSliderRect({ left: 0, top: 0, width: 200, height: 40 });
    fixture.detectChanges();

    const slider = getSliderComponent();
    dispatchPointerEvent('pointerdown', slider.trackRef().nativeElement, {
      clientX: 40,
      clientY: 20,
    });
    dispatchPointerEvent('pointermove', document, { clientX: 160, clientY: 20 });
    dispatchPointerEvent('pointerup', document);
    fixture.detectChanges();

    expect(host.slideChanges()).toEqual([20, 80]);
  });

  it('should calculate vertical percentage from Y coordinate', async () => {
    host.orientation.set('vertical');
    host.step.set(5);
    mockSliderRect({ left: 0, top: 0, width: 40, height: 200 });
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
