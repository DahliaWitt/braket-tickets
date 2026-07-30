/**
 * Registration boundary for the ApexCharts chart types the event analytics
 * charts use.
 *
 * `ChartCoreComponent` loads only `apexcharts/core`, which ships no chart
 * types — each type must be registered before a chart instantiates. Every
 * component that renders an `<apx-chart-core>` must import this module
 * itself: ES module semantics then guarantee registration runs before the
 * component class can be constructed, regardless of which lazy chunk loads
 * first. Never rely on a sibling component's import for registration — the
 * analytics tab loads its charts through concurrent `@defer` blocks, and
 * chunk arrival order is nondeterministic.
 *
 * The import is idempotent: the entry calls `ApexCharts.use()`, which merges
 * the same type map into a global registry on repeated evaluation.
 */
// Registers the Line renderer for: line, area, scatter, bubble, rangeArea.
import 'apexcharts/area';
