import type {ChartOptions} from '../sales-chart/sales-chart.component';

/**
 * jsdom reports zero layout dimensions, which makes ApexCharts bail out
 * before instantiating the chart-type renderer. Patching offsetWidth/Height
 * lets the full render pipeline (type lookup included) run in specs.
 * Returns a restore function for afterEach.
 */
export function patchChartHostDimensions(
  width = 400,
  height = 200,
): () => void {
  // ApexCharts measures via `el.clientWidth`/`el.clientHeight`
  // (Element.prototype) with `offsetWidth`/`offsetHeight` fallbacks
  // (HTMLElement.prototype); patch all four.
  const patches: {
    proto: object;
    prop: string;
    original: PropertyDescriptor | undefined;
  }[] = [];
  const patch = (proto: object, prop: string, value: number): void => {
    patches.push({
      proto,
      prop,
      original: Object.getOwnPropertyDescriptor(proto, prop),
    });
    Object.defineProperty(proto, prop, {
      configurable: true,
      get: () => value,
    });
  };
  patch(HTMLElement.prototype, 'offsetWidth', width);
  patch(HTMLElement.prototype, 'offsetHeight', height);
  patch(Element.prototype, 'clientWidth', width);
  patch(Element.prototype, 'clientHeight', height);
  return () => {
    for (const {proto, prop, original} of patches) {
      if (original) {
        Object.defineProperty(proto, prop, original);
      } else {
        delete (proto as Record<string, unknown>)[prop];
      }
    }
  };
}

interface AreaChartFixtureOverrides {
  data?: {x: number; y: number}[];
}

/**
 * Minimal valid ChartOptions for spec use. Mirrors the area-type config the
 * analytics tab produces, without CSS-variable or dark-mode lookups.
 */
export function buildAreaChartOptions(
  overrides: AreaChartFixtureOverrides = {},
): ChartOptions {
  const data = overrides.data ?? [
    {x: 1735689600000, y: 2},
    {x: 1735693200000, y: 5},
    {x: 1735696800000, y: 3},
  ];

  return {
    series: [{name: 'Test Series', data}],
    chart: {
      type: 'area',
      height: 200,
      background: 'transparent',
      toolbar: {show: false},
      animations: {enabled: false},
    },
    xaxis: {type: 'numeric'},
    yaxis: {min: 0},
    dataLabels: {enabled: false},
    stroke: {curve: 'smooth', width: 2},
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.4,
        opacityTo: 0.05,
        stops: [0, 100],
      },
    },
    grid: {strokeDashArray: 4},
    tooltip: {theme: 'light'},
    markers: {size: 0},
    theme: {mode: 'light'},
    colors: ['#ff0055'],
  };
}
