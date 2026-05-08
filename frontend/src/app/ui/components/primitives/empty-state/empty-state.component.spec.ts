import {ChangeDetectionStrategy, Component, signal} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {EmptyStateComponent} from './empty-state.component';
import {EmptyStateComponentHarness} from './empty-state.component.harness';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyStateComponent],
  template: `
    <app-empty-state
      [title]="title()"
      [description]="description()"
      [isStatus]="isStatus()"
      [ariaLabel]="ariaLabel()"
    />
  `,
})
class EmptyStateHostComponent {
  readonly title = signal('Test Title');
  readonly description = signal('Test Description');
  readonly isStatus = signal(false);
  readonly ariaLabel = signal('');
}

describe('EmptyStateComponent', () => {
  let fixture: ComponentFixture<EmptyStateHostComponent>;
  let component: EmptyStateHostComponent;
  let harness: EmptyStateComponentHarness;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmptyStateHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(EmptyStateHostComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    harness = await TestbedHarnessEnvironment.loader(fixture).getHarness(
      EmptyStateComponentHarness,
    );
  });

  it('renders title and description through the harness', async () => {
    expect(await harness.getTitle()).toBe('Test Title');
    expect(await harness.getDescription()).toBe('Test Description');
  });

  it('exposes status and aria-label semantics', async () => {
    component.isStatus.set(true);
    component.ariaLabel.set('No results');
    fixture.detectChanges();

    expect(await harness.isStatus()).toBe(true);
    expect(await harness.getAriaLabel()).toBe('No results');
  });
});
