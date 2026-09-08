# Charts

`slide.charts` creates chart elements with slide placement and chart configuration.

## Resolved From Inspect

```ts
const chart = presentation.resolve("ch/b2c3d4e5");
chart.title = "Updated chart title";
chart.yAxis = { numberFormatCode: "$#,##0M" };
chart.series.getItemAt(0).values = [3.1, 3.7, 4.2, 4.8];
```

Use `presentation.inspect({ kind: "chart", search })` to find the `ch/...`
anchor id. If an imported chart resolves as an image, preserve it as an image or
rebuild it as a native chart intentionally.

## Add Chart

```ts
const chart = slide.charts.add(chartType, {
  position,
  title,
  titleTextStyle,
  categories,
  series,
  hasLegend,
  legend,
  barOptions,
  lineOptions,
  areaOptions,
  pieOptions,
  doughnutOptions,
  treemapOptions,
  mapOptions,
  funnelOptions,
  boxWhiskerOptions,
  histogramOptions,
  view3d,
  scatterOptions,
  xAxis,
  yAxis,
  dataLabels,
  dataTable,
  chartFill,
  chartLine,
  plotAreaFill,
  plotAreaLine,
});
```

Small chart option enums are listed below.

## Chart Inline Types

```ts
type ChartTypeName =
  | "line" | "pie" | "bar" | "doughnut" | "scatter" | "bubble" | "radar"
  | "treemap" | "sunburst" | "map" | "waterfall" | "line3D" | "pie3D"
  | "area3D" | "bar3D" | "funnel" | "histogram" | "boxWhisker" | "stock"
  | "surface3D" | "ofPie" | "surface" | "pareto" | "combo" | "area";

type ChartConfig = {
  position?: { left?: number; top?: number; width?: number; height?: number };
  title?: string;
  titlePlacement?: "none" | "aboveChart" | "centeredOverlay";
  titleTextStyle?: ChartTextStyleConfig;
  categories?: string[];
  series?: ChartSeriesConfig[];
  hasLegend?: boolean;
  legend?: ChartLegendConfig;
  barOptions?: { direction?: "bar" | "column"; grouping?: "clustered" | "stacked" | "percentStacked"; varyColors?: boolean; gapWidth?: number; gapDepth?: number; overlap?: number; bar3dShape?: number };
  lineOptions?: { grouping?: "standard" | "stacked" | "percentStacked"; smooth?: boolean; varyColors?: boolean };
  areaOptions?: { grouping?: "standard" | "stacked" | "percentStacked"; varyColors?: boolean };
  pieOptions?: { firstSliceAngle?: number };
  doughnutOptions?: { holeSize?: number; firstSliceAngle?: number };
  treemapOptions?: { parentLabelLayout?: "none" | "overlapping" | "banner" };
  mapOptions?: { mapArea?: "world" | "auto" | "dataOnly" | "region"; projection?: "mercator" | "auto" | "miller" | "albers"; labelLayout?: "none" | "bestFit" | "showAll"; dataLevel?: "auto" | "county" | "postalCode" | "countryOrRegion" | "stateOrProvince" | "stateCode" | "countyCode" | "countryOrRegionCode"; showUnknown?: boolean; onlyRegionsWithData?: boolean };
  funnelOptions?: { gapWidth?: number };
  boxWhiskerOptions?: { showMeanLine?: boolean; showMeanMarker?: boolean; showNonOutliers?: boolean; showOutliers?: boolean; quartileMethod?: "inclusive" | "exclusive" };
  histogramOptions?: { binWidth?: number; intervalClosed?: number; aggregated?: boolean };
  view3d?: { rotX?: number; rotY?: number; perspective?: number; rightAngleAxes?: boolean };
  scatterOptions?: { style?: "line" | "lineWithMarkers" | "marker" | "smooth" | "smoothWithMarkers"; varyColors?: boolean };
  xAxis?: ChartAxisConfig;
  yAxis?: ChartAxisConfig;
  dataLabels?: ChartDataLabelsConfig;
  dataTable?: ChartDataTableConfig;
  chartFill?: FillConfig;
  chartLine?: LineConfig;
  plotAreaFill?: FillConfig;
  plotAreaLine?: LineConfig;
  displayBlanksAs?: "zero" | "gap" | "span";
  styleIndex?: number;
};
```

## Grouped Edits

```ts
chart.xAxis = axisConfig;
chart.yAxis = axisConfig;
chart.legend = legendConfig;
chart.dataLabels = dataLabelsConfig;
chart.dataTable = dataTableConfig;
```

## Series

```ts
const chart = slide.charts.add(chartType, {
  categories,
  series: [
    {
      name: seriesName,
      categories,
      values,
      xValues,
      categoryPaths,
      fill: fillConfig,
      line: lineConfig,
      marker: markerConfig,
      points,
      dataLabelOverrides,
      trendlines,
      errorBars,
    },
  ],
});
```

## Series Inline Type

```ts
type ChartSeriesConfig = {
  name: string;
  categories?: string[];
  values?: number[];
  xValues?: number[];
  categoryPaths?: string[][];
  bubbleSizes?: number[];
  explosion?: number;
  fill?: FillConfig;
  line?: LineConfig;
  stroke?: LineConfig;
  marker?: { symbol?: "circle" | "diamond" | "dot" | "none" | "plus" | "square" | "star" | "triangle" | "x"; size?: number };
  points?: Array<{ idx: number; fill?: FillConfig; line?: LineConfig; stroke?: LineConfig }>;
  dataLabelOverrides?: Array<{ idx: number; text?: string; position?: string; fill?: FillConfig; line?: LineConfig; stroke?: LineConfig; showValue?: boolean; showSeriesName?: boolean; showCategoryName?: boolean; showPercent?: boolean; textStyle?: ChartTextStyleConfig }>;
  trendlines?: Array<{ type: string; name?: string }>;
  errorBars?: { type?: "standardError" | "percentage" | "standardDeviation" | "none"; value?: number; endStyle?: "cap" | "noCap"; line?: LineConfig };
  valuesFormatCode?: string;
  xValuesFormatCode?: string;
};
```

## Data Label Overrides

```ts
const override = chart.series
  .getItemAt(seriesIndex)
  .dataLabelOverrides.add(dataPointIdx);
override.text = labelText;
override.position = labelPosition;
override.textStyle.fontSize = fontSizePx;
override.textStyle.fill = textFill;
override.fill = fillConfig;
override.stroke = lineConfig;
```

## Chart Areas

```ts
const chart = slide.charts.add(chartType, {
  chartFill,
  plotAreaFill,
});
```

## Axis, Legend, Label Inline Types

```ts
type ChartTextStyleConfig = {
  typeface?: string;
  fontSize?: number;
  fill?: FillConfig;
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  alignment?: "left" | "center" | "right" | "justify";
};

// Chart fonts are independent of surrounding shape-text fonts. Set typeface on
// the title, axes, legend, and data labels to the same selected family. Existing
// axis-title text has its own style: chart.xAxis.title.textStyle.typeface (and
// yAxis.title.textStyle.typeface); do not create a title solely to set a font.

type ChartLegendConfig = {
  position?: "left" | "top" | "topRight" | "right" | "bottom";
  overlay?: boolean;
  fill?: FillConfig;
  line?: LineConfig;
  textStyle?: ChartTextStyleConfig;
};

type ChartDataLabelsConfig = {
  position?: "center" | "inEnd" | "outEnd";
  showValue?: boolean;
  showSeriesName?: boolean;
  showCategoryName?: boolean;
  showPercent?: boolean;
  showLeaderLines?: boolean;
  textStyle?: ChartTextStyleConfig;
  fill?: FillConfig;
  line?: LineConfig;
};

type ChartAxisConfig = {
  visible?: boolean;
  title?: string | { text?: string; textStyle?: ChartTextStyleConfig };
  numberFormatCode?: string;
  min?: number;
  max?: number;
  majorUnit?: number;
  minorUnit?: number;
  position?: "bottom" | "left" | "right" | "top";
  tickLabelPosition?: "nextTo" | "high" | "low" | "none" | string;
  textStyle?: ChartTextStyleConfig;
  line?: LineConfig;
  majorGridlines?: LineConfig | null;
  minorGridlines?: LineConfig | null;
};
```

## Cookbook

Label positions depend on chart family. For stacked or percent-stacked bar/column charts use a compatible `inEnd` or `center`, never `outEnd`; hide labels and outlines on invisible offset series. The non-stacked examples below may use `outEnd`. Preserve source data, and verify the exported file rather than inferring compatibility from the API accepting an enum.

```ts
// Executive horizontal bar chart.
slide.charts.add("bar", {
  position: { left: 96, top: 160, width: 720, height: 360 },
  categories: ["Enterprise", "Mid-market", "SMB"],
  series: [{ name: "ARR", values: [42, 28, 17], fill: "#2563eb" }],
  barOptions: { direction: "bar", grouping: "clustered", gapWidth: 44 },
  hasLegend: false,
  xAxis: { visible: false, majorGridlines: null },
  yAxis: { textStyle: { fill: "#475569", fontSize: 13 }, line: { style: "solid", fill: "#e2e8f0", width: 1 } },
  dataLabels: { showValue: true, position: "outEnd", textStyle: { fill: "#0f172a", fontSize: 13, bold: true } },
});
```

```ts
// Compact trend line with muted grid.
slide.charts.add("line", {
  position: { left: 96, top: 150, width: 880, height: 280 },
  categories: ["Jan", "Feb", "Mar", "Apr"],
  series: [{ name: "Conversion", values: [0.31, 0.34, 0.37, 0.43], line: { style: "solid", fill: "#0f766e", width: 3 } }],
  legend: { position: "bottom", overlay: false },
  yAxis: { numberFormatCode: "0%", majorGridlines: { style: "solid", fill: "#e2e8f0", width: 1 } },
});
```

```ts
// Doughnut chart with labels outside.
slide.charts.add("doughnut", {
  categories: ["Product", "Sales", "Support"],
  series: [{ name: "Share", values: [52, 31, 17] }],
  dataLabels: { showPercent: true, showCategoryName: true, position: "outEnd" },
  legend: { position: "right" },
});
```
