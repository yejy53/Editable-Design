# Layouts

Layouts define reusable placeholder structure for slides.

## Create A Layout

```ts
const layout = presentation.layouts.add(layoutName);
layout.placeholders.add({
  type: placeholderType,
  index: placeholderIndex,
  text: placeholderText,
  geometry: "textbox",
});
```

## Placeholder Inline Type

```ts
type PlaceholderConfig = {
  type?:
    | "title"
    | "subtitle"
    | "body"
    | "picture"
    | "chart"
    | "table"
    | "content";
  index?: number;
  text?: TextValue;
  geometry?: "textbox" | "rect" | "roundRect" | string;
  position?: { left?: number; top?: number; width?: number; height?: number };
  fill?: FillConfig;
  line?: LineConfig;
};
```

## Shape-Based Placeholders

```ts
const placeholder = layout.shapes.addPlaceholder(placeholderName);
placeholder.placeholder.type = placeholderType;
placeholder.placeholder.index = placeholderIndex;
placeholder.text = placeholderText;
```

## Use A Layout

```ts
slide.setLayout(layout);

const target = slide.placeholders.getItem(placeholderType);
target.text = textValue;
```

## Discover

```ts
const layoutSummary = layout.placeholders.summary();
const resolved = presentation.layouts.getById(layout.id);
```

Imported layouts and masters expose their preserved PowerPoint guide metadata
through the read-only `slideGuides` collection. Use `presentation.view` to
control whether imported guides are visible.

```ts
const importedGuides = presentation.layouts.items[0].slideGuides;
```

## Cookbook

```ts
// Branded title/body layout.
const layout = presentation.layouts.add("Title Body");
layout.placeholders.add({
  type: "title",
  index: 0,
  geometry: "textbox",
  position: { left: 72, top: 64, width: 920, height: 88 },
  text: "Title",
});
layout.placeholders.add({
  type: "body",
  index: 0,
  geometry: "roundRect",
  position: { left: 72, top: 180, width: 760, height: 360 },
  fill: "slate-50",
  line: { style: "solid", fill: "slate-200", width: 1 },
});
```

```ts
// Use placeholders for repeated structure; override slide content locally.
const slide = presentation.slides.add({ layout: "Title Body" });
slide.placeholders.getItem("title").text = "Market overview";
slide.placeholders.getItem("body").text = "Three editable points go here.";
```
