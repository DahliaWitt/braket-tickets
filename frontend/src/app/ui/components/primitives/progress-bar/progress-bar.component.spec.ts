import '../../../../../test-setup';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ZardProgressBarComponent } from './progress-bar.component';
import { ZardProgressBarComponentHarness } from './progress-bar.component.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <z-progress-bar
      [progress]="progress()"
      [zIndeterminate]="indeterminate()"
      [zAriaLabel]="ariaLabel()"
    />
  `,
  imports: [ZardProgressBarComponent],
})
class ProgressBarHostComponent {
  readonly progress = signal(0);
  readonly indeterminate = signal(false);
  readonly ariaLabel = signal('');
}

describe('ZardProgressBarComponent', () => {
  let fixture: ComponentFixture<ProgressBarHostComponent>;
  let component: ProgressBarHostComponent;
  let harness: ZardProgressBarComponentHarness;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProgressBarHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ProgressBarHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    const loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(ZardProgressBarComponentHarness);
  });

  it('should clamp progress above 100 to 100', async () => {
    component.progress.set(175);
    fixture.detectChanges();

    expect(await harness.getAriaValueNow()).toBe('100');
    expect(await harness.getDeterminateWidthStyle()).toContain('100%');
  });

  it('should clamp progress below 0 to 0', async () => {
    component.progress.set(-40);
    fixture.detectChanges();

    expect(await harness.getAriaValueNow()).toBe('0');
    expect(await harness.getDeterminateWidthStyle()).toContain('0%');
  });

  it('should use progress-specific default aria label in determinate mode', async () => {
    component.progress.set(42);
    component.indeterminate.set(false);
    component.ariaLabel.set('');
    fixture.detectChanges();

    expect(await harness.getAriaBusy()).toBeNull();
    expect(await harness.getAriaValueNow()).toBe('42');
    expect(await harness.getAriaLabel()).toBe('Progress: 42%');
  });

  it('should use loading defaults in indeterminate mode', async () => {
    component.indeterminate.set(true);
    component.ariaLabel.set('');
    fixture.detectChanges();

    expect(await harness.getAriaBusy()).toBe('true');
    expect(await harness.getAriaValueNow()).toBeNull();
    expect(await harness.getAriaLabel()).toBe('Loading progress');
    expect(await harness.getDeterminateWidthStyle()).toBeNull();
  });

  it('should respect custom aria label in both modes', async () => {
    component.ariaLabel.set('Ticket loading progress');
    component.indeterminate.set(false);
    fixture.detectChanges();
    expect(await harness.getAriaLabel()).toBe('Ticket loading progress');

    component.indeterminate.set(true);
    fixture.detectChanges();
    expect(await harness.getAriaLabel()).toBe('Ticket loading progress');
  });
});
