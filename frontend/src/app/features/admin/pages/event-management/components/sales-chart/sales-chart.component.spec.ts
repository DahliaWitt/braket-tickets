import '../../../../../../../test-setup';
import {type ComponentFixture, TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {expect, describe, it, vi, beforeEach, afterEach} from 'vitest';
// IMPORTANT: this spec must never import CheckInChartComponent. Together with
// check-in-chart.component.spec.ts (which never imports SalesChartComponent),
// it proves each chart registers its own ApexCharts chart types — every load
// order of the two lazy chunks is safe. Vitest isolates the module graph per
// spec file, so each file exercises a genuinely cold registry.
import {SalesChartComponent} from './sales-chart.component';
import {SalesChartComponentHarness} from './sales-chart.component.harness';
import {
  buildAreaChartOptions,
  patchChartHostDimensions,
} from '../testing/chart-options.fixture';

describe('SalesChartComponent', () => {
  let fixture: ComponentFixture<SalesChartComponent>;
  let restoreDimensions: () => void;

  beforeEach(() => {
    restoreDimensions = patchChartHostDimensions();
  });

  afterEach(() => {
    restoreDimensions();
    TestBed.resetTestingModule();
  });

  async function setup(
    options = buildAreaChartOptions(),
  ): Promise<SalesChartComponentHarness> {
    TestBed.configureTestingModule({
      imports: [SalesChartComponent],
      providers: [provideZonelessChangeDetection()],
    });

    fixture = TestBed.createComponent(SalesChartComponent);
    fixture.componentRef.setInput('options', options);
    fixture.detectChanges();
    await fixture.whenStable();
    return TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      SalesChartComponentHarness,
    );
  }

  it('draws the series without any sibling chart component loaded', async () => {
    const harness = await setup();

    expect(await harness.isChartPresent()).toBe(true);
    await vi.waitFor(async () => {
      expect(await harness.hasRenderedSeries()).toBe(true);
    });
  });

  it('mounts the chart with an empty series without throwing', async () => {
    const harness = await setup(buildAreaChartOptions({data: []}));

    await vi.waitFor(async () => {
      expect(await harness.hasRenderedSvg()).toBe(true);
    });
  });
});
