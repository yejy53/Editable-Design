# Shapes

`slide.shapes` creates and edits drawable slide elements.

## Preset Shape

```ts
const shape = slide.shapes.add({
  geometry,
  name,
  position,
  fill,
  line,
  adjustmentList,
  borderRadius,
  shadow,
  className,
});

shape.text = textValue;
shape.text.style = {
  styleName: textStyleName,
  fontSize,
  bold,
  color,
};
shape.position = nextPosition;
```

`geometry` is a string preset shape name, `"textbox"`, `"connector"`, or `"custom"`.

## Resolved From Inspect

```ts
const shape = presentation.resolve("sh/a1b2c3d4");
shape.text = "Updated copy";
shape.fill = "accent1+18/90";
shape.line = { style: "solid", fill: "slate-200", width: 1 };
shape.borderRadius = "rounded-2xl";
shape.shadow = "shadow-sm";
```

Use `presentation.inspect({ kind: "shape,textbox", search })` to find the
`sh/...` anchor id. Keep the resolved facade type-aware; do not rebuild an
imported shape unless the task requires a new object.

## Preset Shape Inline Type

```ts
type ShapePresetName = string; // common: "textbox", "rect", "roundRect", "ellipse", "line", "rightArrow"
// Full preset list: rg "SHAPE_GEOMETRY_NAME_TO_PROTO" src/models/presentation src/assets

type PositionConfig = {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  rotation?: number;
  horizontalFlip?: boolean;
  verticalFlip?: boolean;
};

type PresetShapeConfig = {
  geometry: ShapePresetName;
  name?: string;
  position?: PositionConfig;
  fill?: FillConfig;
  line?: LineConfig;
  adjustmentList?: Array<{ name: string; formula: string }>;
  borderRadius?: number | string; // number = pixels; string = supported rounded-* token
  shadow?: string; // shadow token, "shadow-none", or custom "2px 7px 19px #000000/17"
  className?: string;
  placeholderType?: "title" | "subtitle" | "body" | "picture" | "chart" | "table" | "content";
  placeholderIndex?: number;
};
```

## Rounded Corners

Prefer `borderRadius` for rect-like rounded corners:

```ts
slide.shapes.add({
  geometry: "rect",
  position: { left: 80, top: 120, width: 320, height: 160 },
  fill: "white",
  borderRadius: "rounded-2xl",
});

shape.borderRadius = 24;
```

Numbers are pixels. Strings use supported `rounded-*` tokens. `borderRadius`
requires a shape with width/height and is supported for `rect`, `textbox`, and
`roundRect`-like shapes. Use `adjustmentList` only when you need exact OpenXML
preset adjustment formulas.

## Rounded Rect Adjustment

```ts
const rounded = slide.shapes.add({
  geometry: "roundRect",
  position,
  fill,
  line,
  adjustmentList: [{ name: "adj", formula: adjustmentFormula }],
});
```

The `adj` value uses the OpenXML shape adjustment scale for the corner radius.

## Custom Path

```ts
const custom = slide.shapes.add({
  geometry: "custom",
  position,
  fill,
  line,
  customPaths: [
    {
      width,
      height,
      commands,
    },
  ],
});
```

Custom path coordinates use pixels in the path viewport.

## Custom Path Inline Type

```ts
type CustomShapeConfig = Omit<PresetShapeConfig, "geometry"> & {
  geometry: "custom";
  customPaths: Array<{
    id?: string;
    width: number;
    height: number;
    commands: Array<
      | { moveTo: { x: number; y: number } }
      | { lineTo: { x: number; y: number } }
      | { close: Record<string, never> }
    >;
  }>;
};
```

## Connector

```ts
const connector = slide.shapes.connect(sourceShape, targetShape, {
  kind: "elbow",
  fromSide: "right",
  toSide: "left",
  line: { style: "solid", fill: "slate-400", width: 2 },
  head: { type: "arrow", width: "med", length: "med" },
});
```

Use [`connectors.md`](./connectors.md) for connector routing, side anchors,
direct `geometry: "connector"` creation, arrowheads, and endpoint edits.

## Line Primitive Decision

| Need | Use |
| --- | --- |
| Divider inside compose JSX | `<rule stroke="slate-200" weight={1} />` |
| Free-positioned line | `slide.shapes.add({ geometry: "line", position, fill: "none", line })` |
| Arrow connected to shapes | `slide.shapes.connect(fromShape, toShape, { line, head })` |
| Border around a surface | shape or box `line={{ style: "solid", fill: "slate-200", width: 1 }}` |

## Shadows

Supported shadow tokens:

```text
shadow-none, shadow-sm, shadow, shadow-md, shadow-lg, shadow-xl, shadow-2xl
```

Custom shadow strings are also supported when the presentation has a theme
context:

```ts
shape.shadow = "shadow-md";
shape.shadow = "2px 7px 19px #000000/17";
shape.shadow = "shadow-none";
```

## Ordering

```ts
shape.bringToFront();
shape.sendToBack();
```

## Cookbook

```ts
// KPI metric surface.
const metricSurface = slide.shapes.add({
  geometry: "roundRect",
  name: "kpi-surface",
  position: { left: 64, top: 132, width: 260, height: 148 },
  fill: "white",
  line: { style: "solid", fill: "slate-200", width: 1 },
  borderRadius: "rounded-2xl",
  shadow: "shadow-md",
});
metricSurface.text = "Revenue\n$12.4M";
metricSurface.text.style = {
  className: "text-slate-950 text-2xl font-bold leading-tight",
};
```

```ts
// Pill label.
const pill = slide.shapes.add({
  geometry: "roundRect",
  position: { left: 64, top: 64, width: 148, height: 34 },
  fill: "emerald-50",
  line: { style: "solid", fill: "emerald-200", width: 1 },
  borderRadius: "rounded-full",
});
pill.text = "ON TRACK";
pill.text.style = { className: "text-emerald-800 text-sm font-bold" };
```

```ts
// Directional connector between two shapes.
slide.shapes.connect(sourceShape, targetShape, {
  kind: "elbow",
  fromSide: "right",
  toSide: "left",
  line: { style: "solid", fill: "slate-400", width: 2 },
  head: { type: "triangle", width: "sm", length: "sm" },
});
```
