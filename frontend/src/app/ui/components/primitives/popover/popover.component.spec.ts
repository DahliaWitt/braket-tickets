import { type HarnessLoader } from '@angular/cdk/testing';
import { OverlayContainer, OverlayModule } from '@angular/cdk/overlay';
import type { ConnectedPosition } from '@angular/cdk/overlay';
import { PortalModule } from '@angular/cdk/portal';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ZardPopoverPlacement,
  type ZardPopoverTrigger,
  ZardPopoverComponent,
  ZardPopoverDirective,
} from './popover.component';
import { PopoverContentHarness, PopoverTriggerHarness } from './popover.component.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      zPopover
      [zTrigger]="trigger()"
      [zContent]="contentTemplate"
      [zPlacement]="placement()"
      [zVisible]="visible()"
      [zOverlayClickable]="overlayClickable()"
      [zHoverDelay]="hoverDelay()"
      [zHoverGrace]="hoverGrace()"
      (zVisibleChange)="onVisibleChange($event)"
    >
      Trigger
    </button>

    <ng-template #contentTemplate>
      <z-popover>Popover content</z-popover>
    </ng-template>
  `,
  imports: [ZardPopoverDirective, ZardPopoverComponent],
})
class TestHostComponent {
  readonly trigger = signal<ZardPopoverTrigger>('click');
  readonly placement = signal<ZardPopoverPlacement>('bottom');
  readonly visible = signal(false);
  readonly overlayClickable = signal(true);
  readonly hoverDelay = signal<number>(200);
  readonly hoverGrace = signal<number>(300);

  readonly visibleChanges = signal<boolean[]>([]);

  onVisibleChange(next: boolean): void {
    this.visibleChanges.update((changes) => [...changes, next]);
  }
}

interface PopoverDirectiveTestApi {
  getPositions(): ConnectedPosition[];
  hide(): void;
}

/**
 * Simulates a genuine outside pointer interaction the way a user would: the CDK
 * OverlayOutsideClickDispatcher listens for `pointerdown` then `click`/`auxclick`/
 * `contextmenu` on document.body (capture phase). Dispatching this sequence on an
 * element outside the overlay drives the real outsidePointerEvents() stream.
 */
function dispatchOutsidePointer(target: EventTarget): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  target.dispatchEvent(new Event('click', { bubbles: true }));
}

describe('ZardPopoverDirective', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let loader: HarnessLoader;
  let documentRootLoader: HarnessLoader;

  const getDirective = (): ZardPopoverDirective =>
    fixture.debugElement.children[0].injector.get(ZardPopoverDirective);

  const getApi = (): PopoverDirectiveTestApi =>
    getDirective() as unknown as PopoverDirectiveTestApi;

  const getOverlayCount = async (): Promise<number> =>
    (await documentRootLoader.getAllHarnesses(PopoverContentHarness)).length;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent, OverlayModule, PortalModule],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    loader = TestbedHarnessEnvironment.loader(fixture);
    documentRootLoader = TestbedHarnessEnvironment.documentRootLoader(fixture);
  });

  it('should toggle popover on click trigger and emit visible change', async () => {
    const trigger = await loader.getHarness(PopoverTriggerHarness);

    await trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await getOverlayCount()).toBe(1);
    expect(host.visibleChanges()).toEqual([true]);

    const content = await documentRootLoader.getHarness(PopoverContentHarness);
    expect(await content.getText()).toContain('Popover content');

    await trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await getOverlayCount()).toBe(0);
    expect(host.visibleChanges()).toEqual([true, false]);
  });

  it('should toggle popover with Enter and Space keyboard activation', async () => {
    const trigger = await loader.getHarness(PopoverTriggerHarness);

    await trigger.keydown('Enter');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    await trigger.keydown(' ');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(0);
  });

  it('should hide popover on Escape when visible', async () => {
    const trigger = await loader.getHarness(PopoverTriggerHarness);
    await trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    await trigger.keydown('Escape');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(0);
  });

  it('should dismiss popover when a click trigger receives an outside pointer event', async () => {
    const trigger = await loader.getHarness(PopoverTriggerHarness);

    await trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    dispatchOutsidePointer(document.body);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await getOverlayCount()).toBe(0);
    expect(host.visibleChanges()).toEqual([true, false]);
  });

  it('should NOT dismiss popover when the pointer event originates inside the content', async () => {
    const trigger = await loader.getHarness(PopoverTriggerHarness);

    await trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    const content = await documentRootLoader.getHarness(PopoverContentHarness);
    await content.clickContent();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await getOverlayCount()).toBe(1);
    expect(host.visibleChanges()).toEqual([true]);
  });

  it('should NOT dismiss on outside click when zOverlayClickable is false', async () => {
    host.overlayClickable.set(false);
    fixture.detectChanges();
    await fixture.whenStable();

    const trigger = await loader.getHarness(PopoverTriggerHarness);
    await trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    dispatchOutsidePointer(document.body);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await getOverlayCount()).toBe(1);
  });

  it('should establish exactly one outside-click subscription across reopen (no stacking)', async () => {
    const hideSpy = vi.spyOn(getApi(), 'hide');
    const trigger = await loader.getHarness(PopoverTriggerHarness);

    // Open, dismiss via outside click.
    await trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    dispatchOutsidePointer(document.body);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(0);
    expect(hideSpy).toHaveBeenCalledTimes(1);

    // Reopen, dismiss again. A stacked subscription would call hide() twice.
    await trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    dispatchOutsidePointer(document.body);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(0);
    expect(hideSpy).toHaveBeenCalledTimes(2);
    expect(host.visibleChanges()).toEqual([true, false, true, false]);
  });

  it('should tear down the outside-click subscription on destroy', async () => {
    const overlayContainer =
      TestBed.inject(OverlayContainer).getContainerElement();
    const trigger = await loader.getHarness(PopoverTriggerHarness);
    await trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    const hideSpy = vi.spyOn(getApi(), 'hide');
    fixture.destroy();

    // The overlay is disposed and the subscription torn down: the container is
    // empty and a subsequent outside pointer event must not reach hide().
    // (The harness loader can't be used post-destroy, so assert on the
    // OverlayContainer element directly.)
    expect(overlayContainer.childElementCount).toBe(0);
    expect(() => dispatchOutsidePointer(document.body)).not.toThrow();
    expect(hideSpy).not.toHaveBeenCalled();
  });

  it('should show/hide popover for hover and focus interactions', async () => {
    vi.useFakeTimers();
    host.trigger.set('hover');
    host.hoverDelay.set(200);
    host.hoverGrace.set(300);
    fixture.detectChanges();
    await fixture.whenStable();

    const trigger = await loader.getHarness(PopoverTriggerHarness);

    await trigger.mouseEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(0);

    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    await trigger.mouseLeave();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(0);

    await trigger.focus();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    await trigger.blur();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(0);

    vi.useRealTimers();
  });

  it('should cancel hover-delay timer when mouseleave fires before delay expires', async () => {
    vi.useFakeTimers();
    host.trigger.set('hover');
    host.hoverDelay.set(200);
    host.hoverGrace.set(300);
    fixture.detectChanges();
    await fixture.whenStable();

    const trigger = await loader.getHarness(PopoverTriggerHarness);

    await trigger.mouseEnter();
    vi.advanceTimersByTime(100);
    await trigger.mouseLeave();
    vi.advanceTimersByTime(500);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(await getOverlayCount()).toBe(0);

    vi.useRealTimers();
  });

  it('should cancel grace timer when mouseenter fires during grace period', async () => {
    vi.useFakeTimers();
    host.trigger.set('hover');
    host.hoverDelay.set(200);
    host.hoverGrace.set(300);
    fixture.detectChanges();
    await fixture.whenStable();

    const trigger = await loader.getHarness(PopoverTriggerHarness);

    await trigger.mouseEnter();
    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    await trigger.mouseLeave();
    vi.advanceTimersByTime(150);

    await trigger.mouseEnter();
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
    await fixture.whenStable();

    vi.advanceTimersByTime(200);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    vi.useRealTimers();
  });

  it('should reflect external zVisible input state changes', async () => {
    host.visible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(1);

    host.visible.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(await getOverlayCount()).toBe(0);
  });

  it('should compute placement fallbacks for all placements', () => {
    const expectations: Record<ZardPopoverPlacement, ConnectedPosition> = {
      bottom: {
        originX: 'center',
        originY: 'bottom',
        overlayX: 'center',
        overlayY: 'top',
        offsetX: 0,
        offsetY: 8,
      },
      top: {
        originX: 'center',
        originY: 'top',
        overlayX: 'center',
        overlayY: 'bottom',
        offsetX: 0,
        offsetY: -8,
      },
      right: {
        originX: 'end',
        originY: 'center',
        overlayX: 'start',
        overlayY: 'center',
        offsetX: 8,
        offsetY: 0,
      },
      left: {
        originX: 'start',
        originY: 'center',
        overlayX: 'end',
        overlayY: 'center',
        offsetX: -8,
        offsetY: 0,
      },
    };

    for (const placement of Object.keys(expectations) as ZardPopoverPlacement[]) {
      host.placement.set(placement);
      fixture.detectChanges();

      const positions = getApi().getPositions();
      expect(positions).toHaveLength(4);
      expect(positions[0]).toMatchObject(expectations[placement]);
    }
  });
});
