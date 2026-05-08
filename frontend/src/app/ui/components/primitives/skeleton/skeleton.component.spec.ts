import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type ComponentFixture, TestBed} from '@angular/core/testing';

import {ZardSkeletonComponent} from './skeleton.component';
import {ZardSkeletonComponentHarness} from './skeleton.component.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZardSkeletonComponent],
  template: `
    <z-skeleton
      [class]="customClass()"
      [width]="width()"
      [height]="height()"
      [zAnimation]="animation()"
    />
  `,
})
class SkeletonHostComponent {
  readonly customClass = signal('');
  readonly width = signal<string | undefined>(undefined);
  readonly height = signal<string | undefined>(undefined);
  readonly animation = signal<'pulse' | 'shimmer'>('pulse');
}

describe('ZardSkeletonComponent', () => {
  let fixture: ComponentFixture<SkeletonHostComponent>;
  let harness: ZardSkeletonComponentHarness;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SkeletonHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SkeletonHostComponent);
    fixture.detectChanges();

    const loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(ZardSkeletonComponentHarness);
  });

  it('renders accessible skeleton defaults', async () => {
    expect(await harness.getRole()).toBe('presentation');
    expect(await harness.getAriaHidden()).toBe('true');
  });

  it('applies caller-provided classes to the rendered skeleton', async () => {
    fixture.componentInstance.customClass.set('h-10 w-40 rounded-lg');
    fixture.detectChanges();

    expect(await harness.hasClass('h-10')).toBe(true);
    expect(await harness.hasClass('w-40')).toBe(true);
    expect(await harness.hasClass('rounded-lg')).toBe(true);
  });

  it('binds width and height styles', async () => {
    fixture.componentInstance.width.set('10rem');
    fixture.componentInstance.height.set('2.5rem');
    fixture.detectChanges();

    expect(await harness.getWidthStyle()).toBe('10rem');
    expect(await harness.getHeightStyle()).toBe('2.5rem');
  });

  it('defaults to pulse animation', async () => {
    const animation = await harness.getAnimation();
    expect(animation).toBe('pulse');
  });

  it('reports shimmer via harness getAnimation()', async () => {
    fixture.componentInstance.animation.set('shimmer');
    fixture.detectChanges();
    const animation = await harness.getAnimation();
    expect(animation).toBe('shimmer');
  });
});
