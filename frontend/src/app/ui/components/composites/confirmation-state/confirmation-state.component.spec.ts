import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {ConfirmationStateComponent} from './confirmation-state.component';
import {ConfirmationStateHarness} from './confirmation-state.component.harness';
import type {ZardIcon} from '@ui/components/primitives/icon/icons';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-confirmation-state
      [icon]="icon()"
      [title]="title()"
      [description]="description()"
      [variant]="variant()"
      [loading]="loading()"
      [iconId]="iconId()"
      [descriptionId]="descriptionId()"
    >
      @if (showAction()) {
        <button type="button" class="action-btn">Action</button>
      }
    </app-confirmation-state>
  `,
  imports: [ConfirmationStateComponent],
})
class TestHostComponent {
  readonly icon = signal<ZardIcon>('check');
  readonly title = signal('Test Title');
  readonly description = signal<string | undefined>(undefined);
  readonly variant = signal<
    'loading' | 'success' | 'error' | 'warning' | 'info'
  >('info');
  readonly loading = signal(false);
  readonly iconId = signal<string | undefined>(undefined);
  readonly descriptionId = signal<string | undefined>(undefined);
  readonly showAction = signal(false);
}

describe('ConfirmationStateComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let harness: ConfirmationStateHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection()],
    });
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    harness = await loader.getHarness(ConfirmationStateHarness);
  });

  it('should render title', async () => {
    expect(await harness.getHeadingText()).toBe('Test Title');
  });

  it('should not render description when not provided', async () => {
    expect(await harness.getDescriptionText()).toBeNull();
  });

  it('should render description when provided', async () => {
    host = fixture.componentInstance;
    host.description.set('A test description');
    fixture.detectChanges();
    expect(await harness.getDescriptionText()).toBe('A test description');
  });

  it('should apply success variant styles', async () => {
    host = fixture.componentInstance;
    host.variant.set('success');
    fixture.detectChanges();
    const classes = await harness.getIconCircleClasses();
    expect(classes).toContain('bg-secondary/10');
  });

  it('should apply error variant styles', async () => {
    host = fixture.componentInstance;
    host.variant.set('error');
    fixture.detectChanges();
    const classes = await harness.getIconCircleClasses();
    expect(classes).toContain('bg-destructive/20');
  });

  it('should use destructive color for error description', async () => {
    host = fixture.componentInstance;
    host.variant.set('error');
    host.description.set('Something went wrong');
    fixture.detectChanges();
    const classes = await harness.getDescriptionClasses();
    expect(classes).toContain('text-destructive-text');
  });

  it('should use muted-foreground for non-error description', async () => {
    host = fixture.componentInstance;
    host.variant.set('success');
    host.description.set('All done');
    fixture.detectChanges();
    const classes = await harness.getDescriptionClasses();
    expect(classes).toContain('text-muted-foreground');
  });

  it('should show loading state with pulse animation', async () => {
    host = fixture.componentInstance;
    host.loading.set(true);
    host.variant.set('loading');
    fixture.detectChanges();
    expect(await harness.hasSpinner()).toBe(true);
  });

  it('should apply iconId to the circle element', async () => {
    host = fixture.componentInstance;
    host.iconId.set('success-icon');
    fixture.detectChanges();
    expect(await harness.getIconCircleId()).toBe('success-icon');
  });

  it('should not set id when iconId is not provided', async () => {
    expect(await harness.getIconCircleId()).toBeNull();
  });

  it('should apply descriptionId to description paragraph', async () => {
    host = fixture.componentInstance;
    host.description.set('Error detail');
    host.descriptionId.set('error-message');
    fixture.detectChanges();
    expect(await harness.getDescriptionId()).toBe('error-message');
  });

  it('should project ng-content', async () => {
    host = fixture.componentInstance;
    host.showAction.set(true);
    fixture.detectChanges();
    const actionBtn = await harness.getActionBtn();
    expect(actionBtn).not.toBeNull();
  });
});
