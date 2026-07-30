import type {
  ApexAxisChartSeries,
  ApexChart,
  ApexXAxis,
  ApexDataLabels,
  ApexStroke,
  ApexFill,
  ApexGrid,
  ApexTooltip,
  ApexMarkers,
  ApexTheme,
  ApexYAxis,
} from 'ng-apexcharts';

/** Options contract shared by the event analytics chart components. */
export interface ChartOptions {
  series: ApexAxisChartSeries;
  chart: ApexChart;
  xaxis: ApexXAxis;
  yaxis: ApexYAxis;
  dataLabels: ApexDataLabels;
  stroke: ApexStroke;
  fill: ApexFill;
  grid: ApexGrid;
  tooltip: ApexTooltip;
  markers: ApexMarkers;
  theme: ApexTheme;
  colors: string[];
}
