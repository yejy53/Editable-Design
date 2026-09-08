# Inspect

Use `presentation.inspect(...)` to read compact deck snapshots for create, edit,
and review workflows. Inspect emits NDJSON records with stable anchor ids; pass
those ids to `presentation.resolve(id)` for follow-up edits.

## Snapshot

```ts
const snapshot = await presentation.inspect({
  kind: "slide,textbox,shape,image,table,chart,notes,thread,layout",
  search,
  maxChars,
});
console.log(snapshot.ndjson);
```

Example output:

```text
{"kind":"slide","id":"sl/b2c3d4e5","slide":1,"title":"Revenue outlook","textShapes":4}
{"kind":"textbox","id":"sh/c3d4e5f6","slide":1,"name":"headline","text":"Revenue outlook","textPreview":"Revenue outlook","textChars":15,"textLines":1,"bbox":[72,64,520,96],"bboxUnit":"px"}
{"kind":"chart","id":"ch/d4e5f6a7","slide":1,"name":"arr-chart","chartType":"bar","title":"ARR","bbox":[620,180,520,320],"bboxUnit":"px"}
```

Common `kind` tokens:

```text
deck, slide, textbox, textrange, shape, table, chart, image, notes, thread, layout
```

`comments` is accepted as an alias for the canonical `thread` kind.

Useful `include`/`exclude` tokens:

```text
id, slide, name, title, text, textPreview, textChars, textLines,
bbox, bboxUnit, rows, cols, preview, chartType, alt, prompt,
isPlaceholder, comments, placeholders
```

Use comma-separated strings for `include` and `exclude`:

```ts
const focused = await presentation.inspect({
  kind: "textbox,shape",
  include: "id,slide,name,bbox,textPreview",
  exclude: "preview,comments",
  maxChars: 4000,
});
```

Anchor prefixes:

```text
pr/ deck, sl/ slide, sh/ shape/textbox, ch/ chart, im/ image,
tb/ table, nt/ notes, th/ thread, tr/ text range
```

Only `pr/`, `sl/`, `sh/`, `im/`, `tb/`, `ch/`, `nt/`, `th/`, and `tr/`
anchors are valid for `presentation.resolve(...)`. Layout ids and template ids
from layout exports are for inspection, comparison, and intentional layout
collection edits.

`slide` in inspect records is 1-based for display. `presentation.slides.getItem(index)`
uses 0-based indexes. Prefer resolving anchor ids over converting slide numbers.
Element anchor ids are compact stable ids such as `sh/a1b2c3d4`,
`im/c3d4e5f6`, `tb/d4e5f6a7`, and `ch/b2c3d4e5`. Copy ids from inspect output
and pass them to
`presentation.resolve(id)`.

## Inline Type

```ts
type PresentationInspectOptions = {
  target?: { id: string; beforeLines?: number; afterLines?: number };
  kind?: string;
  include?: string;
  exclude?: string;
  search?: string;
  maxChars?: number;
};
```

## Focused Edit Loop

```ts
const before = await presentation.inspect({
  kind: "slide,textbox,shape,image,table,chart,notes,thread,layout",
  search: "Revenue",
  maxChars: 8000,
});

const target = presentation.resolve(anchorId);

// slideAnchorId is the `sl/...` id from inspect for the affected slide.
const slide = presentation.resolve(slideAnchorId);
const previewBefore = await slide.export({ format: "png", scale: 2 });
const layoutBefore = await slide.export({ format: "layout" });
const montageBefore = await presentation.export({
  format: "webp",
  montage: true,
  scale: 1,
});

target.text.replace("Revenue", "Revenue outlook");

const previewAfter = await slide.export({ format: "png", scale: 2 });
const layoutAfter = await slide.export({ format: "layout" });
const montageAfter = await presentation.export({
  format: "webp",
  montage: true,
  scale: 1,
});

const after = await presentation.inspect({
  target: { id: anchorId, beforeLines: 2, afterLines: 2 },
  kind: "textbox,shape",
  maxChars: 2000,
});
```

## Example Records

```jsonl
{"kind":"slide","id":"sl/a1b2c3d4","slide":1,"title":"Revenue outlook","textShapes":4}
{"kind":"textbox","id":"sh/a1b2c3d4","slide":1,"name":"headline","textPreview":"Revenue outlook","textChars":15,"bbox":[72,64,520,96],"bboxUnit":"px"}
{"kind":"chart","id":"ch/b2c3d4e5","slide":1,"name":"arr-chart","chartType":"bar","title":"ARR","bbox":[620,180,520,320],"bboxUnit":"px"}
{"kind":"thread","id":"th/e5f6a7b8","slide":1,"target":"sh/a1b2c3d4","status":"open","comments":[{"text":"TODO tighten copy"}]}
```

## Imported Templates

```ts
const layoutSnapshot = await presentation.inspect({
  kind: "slide,textbox,shape,image,table,chart,layout",
  maxChars: 8000,
});
```

Use the snapshot to find slide titles, visible text, object names, positions,
and ids before editing imported content.

## Cookbook

```ts
// Search narrowly first.
const hits = await presentation.inspect({
  kind: "slide,textbox,shape,image,table,chart,notes,thread,layout",
  search: "Q4",
  maxChars: 6000,
});
```

```ts
// Then focus around the chosen anchor.
const focused = await presentation.inspect({
  target: { id: "sh/a1b2c3d4", beforeLines: 2, afterLines: 4 },
  kind: "textbox,shape",
  maxChars: 2000,
});
```

```ts
// Preserve evidence before and after an edit.
const before = await presentation.inspect({ kind: "chart,table", search: "ARR", maxChars: 4000 });
presentation.resolve(chartAnchorId).series.getItemAt(0).values = [12, 16, 21, 28];
const after = await presentation.inspect({ target: { id: chartAnchorId }, kind: "chart", maxChars: 2000 });
```

```ts
// Verify one slide visually and structurally.
const slide = presentation.resolve(slideAnchorId);
const preview = await slide.export({ format: "png", scale: 1 });
const layout = await slide.export({ format: "layout" });
```
