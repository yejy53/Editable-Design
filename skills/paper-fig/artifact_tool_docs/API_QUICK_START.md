# Presentation quick start (JavaScript)

Read `references/implementation.md` in the installed skill for runtime setup. Save the example as a `.mjs` file in the private build directory, with its `node_modules` link pointing to the supplied runtime packages. Set `SKILL_DIR` and `TMP_DIR` to absolute paths and run with `RUNTIME_NODE`.

This example shows how to use the API. Its data is made up; do not use it as a factual source or copy its design by default. Use the user's content, design and sources for real tasks. The script writes a draft PPTX and preview, not a checked final deck.

```js
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Presentation, PresentationFile } from "@oai/artifact-tool";

const { SKILL_DIR, TMP_DIR } = process.env;
if (!path.isAbsolute(SKILL_DIR ?? "") || !path.isAbsolute(TMP_DIR ?? "")) {
  throw new Error("Set absolute SKILL_DIR and TMP_DIR");
}
const { resolvePresentationFont, applyPresentationChartFont } = await import(
  pathToFileURL(path.join(SKILL_DIR, "container_tools/artifact_tool_utils.mjs")).href,
);
await fs.mkdir(TMP_DIR, { recursive: true });
const family = resolvePresentationFont();
const presentation = Presentation.create({
  slideSize: { width: 1280, height: 720 },
});
const slide = presentation.slides.add();
slide.background.fill = "#FFFFFF";

const title = slide.shapes.add({
  geometry: "textbox",
  position: { left: 72, top: 48, width: 1136, height: 80 },
  fill: "none",
  line: { fill: "none", width: 0 },
});
title.text = "Monthly order volume";
title.text.style = {
  typeface: family, fontSize: 40, bold: true,
  color: "#142735", autoFit: "none",
};

const chart = slide.charts.add("bar", {
  position: { left: 100, top: 180, width: 1080, height: 400 },
  categories: ["Jan", "Feb", "Mar"],
  series: [{ name: "Orders", values: [120, 145, 160], fill: "#285E8E" }],
  barOptions: { direction: "column", grouping: "clustered" },
  hasLegend: false,
  dataLabels: { showValue: true, position: "outEnd" },
});
applyPresentationChartFont(chart, { fontFamily: family });
slide.speakerNotes.textFrame.setText("Illustrative data for this API example only.");

const candidatePath = path.join(TMP_DIR, "candidate.pptx");
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
const preview = await presentation.export({ slide, format: "png", scale: 1 });
await fs.writeFile(path.join(TMP_DIR, "slide-1.png"),
  new Uint8Array(await preview.arrayBuffer()));
const layout = await slide.export({ format: "layout" });
await fs.writeFile(path.join(TMP_DIR, "slide-1.layout.json"), await layout.text());
```

Next, follow [validation and delivery](../references/finalization.md) and inspect the rendered final file. Also check that charts and tables are editable; preview images cannot show this.

## Existing decks

```js
import { FileBlob, PresentationFile } from "@oai/artifact-tool";
const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));
const snapshot = await presentation.inspect({
  kind: "slide,textbox,shape,image,table,chart,notes,layout",
  maxChars: 8000,
});
console.log(snapshot.ndjson);
// Resolve only an id found in the snapshot, then edit the existing object.
const target = presentation.resolve(verifiedObjectId);
target.text.replace(oldText, newText);
```

For user templates, read [template following](../references/template_following.md) before editing. Use the [API reference map](api/API_DOCS.md#reference-map) to look up objects and the methods for finding and editing them. Other API examples use TypeScript or JSX, which need additional build tools. Do not paste those examples into plain `.mjs` files.
