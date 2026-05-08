import { TestBed } from '@angular/core/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BraStatusBadgeComponent } from './status-badge.component';
import { BraStatusBadgeHarness } from './status-badge.harness';
import type { BraStatusBadgeVariants } from './status-badge.variants';

type StatusBadgeStatus = NonNullable<BraStatusBadgeVariants['status']>;

@Component({
  template: `<bra-status-badge [status]="status()" [live]="live()">{{ text() }}</bra-status-badge>`,
  imports: [BraStatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestHostComponent {
  readonly status = input<StatusBadgeStatus>('muted');
  readonly live = input(false);
  readonly text = input('Draft');
}

describe('BraStatusBadgeComponent', () => {
  async function setup(
    overrides: { status?: StatusBadgeStatus; live?: boolean; text?: string } = {},
  ) {
    TestBed.configureTestingModule({ imports: [TestHostComponent] });
    TestBed.overrideComponent(TestHostComponent, {
      set: {
        template: `<bra-status-badge [status]="'${overrides.status ?? 'muted'}'" [live]="${overrides.live ?? false}">${overrides.text ?? 'Draft'}</bra-status-badge>`,
      },
    });
    const fixture = TestBed.createComponent(TestHostComponent);
    fixture.detectChanges();
    const loader = TestbedHarnessEnvironment.loader(fixture);
    const harness = await loader.getHarness(BraStatusBadgeHarness);
    return { fixture, harness };
  }

  it('should render with muted status by default', async () => {
    const { harness } = await setup();
    expect(await harness.getStatus()).toBe('muted');
    expect(await harness.getText()).toBe('Draft');
  });

  it('should render success status', async () => {
    const { harness } = await setup({ status: 'success', text: 'Active' });
    expect(await harness.getStatus()).toBe('success');
  });

  it('should render warning status', async () => {
    const { harness } = await setup({ status: 'warning', text: 'Pending' });
    expect(await harness.getStatus()).toBe('warning');
  });

  it('should render destructive status', async () => {
    const { harness } = await setup({ status: 'destructive', text: 'Rejected' });
    expect(await harness.getStatus()).toBe('destructive');
  });

  it('should render info status', async () => {
    const { harness } = await setup({ status: 'info', text: 'Info' });
    expect(await harness.getStatus()).toBe('info');
  });

  it('should not have role when live is false', async () => {
    const { harness } = await setup({ live: false });
    expect(await harness.getRole()).toBeNull();
  });

  it('should have role="status" when live is true', async () => {
    const { harness } = await setup({ live: true });
    expect(await harness.getRole()).toBe('status');
  });
});
