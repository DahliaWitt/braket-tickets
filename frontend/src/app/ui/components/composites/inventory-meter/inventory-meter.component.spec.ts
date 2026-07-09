import {TestBed} from '@angular/core/testing';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {type HarnessLoader} from '@angular/cdk/testing';
import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import {BraInventoryMeterComponent} from './inventory-meter.component';
import {BraInventoryMeterHarness} from './inventory-meter.harness';

interface HostInputs {
  soldCount: number;
  heldCount: number;
  totalTickets: number;
  externalCount: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-test-host',
  imports: [BraInventoryMeterComponent],
  template: `
    <bra-inventory-meter
      [soldCount]="inputs().soldCount"
      [heldCount]="inputs().heldCount"
      [totalTickets]="inputs().totalTickets"
      [externalCount]="inputs().externalCount"
    />
  `,
})
class TestHostComponent {
  readonly inputs = signal<HostInputs>({
    soldCount: 0,
    heldCount: 0,
    totalTickets: 100,
    externalCount: 0,
  });
}

describe('BraInventoryMeterComponent', () => {
  let loader: HarnessLoader;
  let host: TestHostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    const fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    loader = TestbedHarnessEnvironment.loader(fixture);
  });

  async function getHarness() {
    return loader.getHarness(BraInventoryMeterHarness);
  }

  it('renders empty state with zero sold and zero held', async () => {
    const harness = await getHarness();
    expect(await harness.getHeadline()).toBe('0 / 100');
    expect(await harness.getPercentage()).toBe('0%');
    expect(await harness.getStatusText()).toContain('100 remaining');
    expect(await harness.hasSoldSegment()).toBe(false);
    expect(await harness.hasHeldSegment()).toBe(false);
  });

  it('renders sold segment when soldCount > 0', async () => {
    host.inputs.set({
      soldCount: 40,
      heldCount: 0,
      totalTickets: 100,
      externalCount: 0,
    });
    const harness = await getHarness();
    expect(await harness.getHeadline()).toBe('40 / 100');
    expect(await harness.getPercentage()).toBe('40%');
    expect(await harness.hasSoldSegment()).toBe(true);
    expect(await harness.hasHeldSegment()).toBe(false);
    expect(await harness.getStatusText()).toBe('60 remaining');
  });

  it('renders held segment and surfaces "in checkout" copy when heldCount > 0', async () => {
    host.inputs.set({
      soldCount: 40,
      heldCount: 10,
      totalTickets: 100,
      externalCount: 0,
    });
    const harness = await getHarness();
    expect(await harness.hasHeldSegment()).toBe(true);
    const status = await harness.getStatusText();
    expect(status).toContain('50 remaining');
    expect(status).toContain('10 in checkout');
  });

  it('shows "sold out" status when sold+held fills capacity', async () => {
    host.inputs.set({
      soldCount: 95,
      heldCount: 5,
      totalTickets: 100,
      externalCount: 0,
    });
    const harness = await getHarness();
    const status = await harness.getStatusText();
    expect(status).toContain('sold out');
    expect(status).toContain('5 in checkout');
  });

  it('shows plain "sold out" when capacity is fully sold with no holds', async () => {
    host.inputs.set({
      soldCount: 100,
      heldCount: 0,
      totalTickets: 100,
      externalCount: 0,
    });
    const harness = await getHarness();
    const status = await harness.getStatusText();
    expect(status).toContain('sold out');
    expect(status).not.toContain('in checkout');
    expect(await harness.hasHeldSegment()).toBe(false);
  });

  it('caps the percentage pill at 100% when soldCount exceeds totalTickets', async () => {
    host.inputs.set({
      soldCount: 120,
      heldCount: 0,
      totalTickets: 100,
      externalCount: 0,
    });
    const harness = await getHarness();
    expect(await harness.getPercentage()).toBe('100%');
  });

  it('provides accessible progressbar text covering sold, held, and remaining', async () => {
    host.inputs.set({
      soldCount: 40,
      heldCount: 10,
      totalTickets: 100,
      externalCount: 0,
    });
    const harness = await getHarness();
    const text = await harness.getAriaValueText();
    expect(text).toContain('40 of 100 sold');
    expect(text).toContain('10 in checkout');
    expect(text).toContain('50 remaining');
  });

  it('reports occupied capacity (sold + held) via aria-valuenow so it matches the bar fill', async () => {
    host.inputs.set({
      soldCount: 40,
      heldCount: 10,
      totalTickets: 100,
      externalCount: 0,
    });
    const harness = await getHarness();
    expect(await harness.getAriaValueNow()).toBe('50');
    expect(await harness.getAriaValueMax()).toBe('100');
  });

  it('clamps aria-valuenow to totalTickets when sold + held would exceed capacity', async () => {
    // Defensive: surface-level race where held spiked past total before a
    // refund catches up. valuenow should not exceed valuemax.
    host.inputs.set({
      soldCount: 60,
      heldCount: 60,
      totalTickets: 100,
      externalCount: 0,
    });
    const harness = await getHarness();
    expect(await harness.getAriaValueNow()).toBe('100');
  });

  it('falls back to 0% percentage when totalTickets is zero (divide guard)', async () => {
    host.inputs.set({
      soldCount: 0,
      heldCount: 0,
      totalTickets: 0,
      externalCount: 0,
    });
    const harness = await getHarness();
    expect(await harness.getPercentage()).toBe('0%');
  });

  it('hides the external annotation when externalCount is 0', async () => {
    host.inputs.set({
      soldCount: 200,
      heldCount: 0,
      totalTickets: 300,
      externalCount: 0,
    });
    const harness = await getHarness();
    expect(await harness.getExternalAnnotation()).toBeNull();
  });

  it('renders "+ N external · M total" when externalCount > 0', async () => {
    host.inputs.set({
      soldCount: 200,
      heldCount: 0,
      totalTickets: 300,
      externalCount: 40,
    });
    const harness = await getHarness();
    expect(await harness.getExternalAnnotation()).toBe(
      '+ 40 external · 240 total',
    );
  });

  it('keeps sold count and percentage native-only when external entries exist', async () => {
    host.inputs.set({
      soldCount: 200,
      heldCount: 0,
      totalTickets: 300,
      externalCount: 40,
    });
    const harness = await getHarness();
    // Primary sold figure and percentage ignore external entries entirely.
    expect(await harness.getHeadline()).toBe('200 / 300');
    expect(await harness.getPercentage()).toBe('67%');
  });
});
