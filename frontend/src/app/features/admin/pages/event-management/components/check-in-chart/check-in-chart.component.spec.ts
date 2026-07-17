import '../../../../../../../test-setup';
import {TestBed} from '@angular/core/testing';
import {provideZonelessChangeDetection} from '@angular/core';
import {TestbedHarnessEnvironment} from '@angular/cdk/testing/testbed';
import {expect, describe, it, vi, beforeEach, afterEach} from 'vitest';
// IMPORTANT: this spec must never import SalesChartComponent (directly or
// transitively). It exists to prove CheckInChartComponent registers its own
// ApexCharts chart types instead of depending on a sibling component's chunk
// having evaluated first. The production race this guards against loaded
// CheckInChart before SalesChart (the only registration site at the time) and
// crashed with `chart type "line" is not registered` in 18/40 cold renders.
import {CheckInChartComponent} from './check-in-chart.component';
import {CheckInChartComponentHarness} from './check-in-chart.component.harness';
import {
  buildAreaChartOptions,
  patchChartHostDimensions,
} from '../testing/chart-options.fixture';

describe('CheckInChartComponent', () => {
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
  ): Promise<CheckInChartComponentHarness> {
    TestBed.configureTestingModule({
      imports: [CheckInChartComponent],
      providers: [provideZonelessChangeDetection()],
    });

    const fixture = TestBed.createComponent(CheckInChartComponent);
    fixture.componentRef.setInput('options', options);
    fixture.detectChanges();
    await fixture.whenStable();
    return TestbedHarnessEnvironment.harnessForFixture(
      fixture,
      CheckInChartComponentHarness,
    );
  }

  it('draws the series without any sibling chart component loaded', async () => {
    const harness = await setup();

    expect(await harness.isChartPresent()).toBe(true);
    await vi.waitFor(
      async () => {
        expect(await harness.hasRenderedSeries()).toBe(true);
      },
      {timeout: 5000},
    );
  });

  it('mounts the chart with an empty series without throwing', async () => {
    const harness = await setup(buildAreaChartOptions({data: []}));

    await vi.waitFor(
      async () => {
        expect(await harness.hasRenderedSvg()).toBe(true);
      },
      {timeout: 5000},
    );
  });
});
