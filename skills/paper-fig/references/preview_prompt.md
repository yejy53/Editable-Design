# Write the full-page drawing prompt

Read this before generating a new full-page preview. Write a complete prompt that an image model can draw directly, rather than a summary of the research. The preview establishes the composition and the visual assets for subsequent faithful PPTX reconstruction. If the user supplies a reference to reconstruct directly, skip preview generation and preserve that design.

## Describe the drawing from the whole page to each region

Start with the figure's subject and visual medium, then specify the canvas dimensions or aspect ratio, background, typography, palette, border and arrow styles, and intended visual density. Follow the user's design directions; do not turn example fonts, ratios, or colors into fixed defaults.

State the overall layout before describing details: rows or columns, approximate relative widths and heights, panel positions, main reading direction, and alignment. Assign enough space to both the scientific structure and its images. Describe balanced use of the available area and useful spacing, rather than simply asking for a "clean" or "publication-quality" figure.

For each region, use a spatial heading such as TOP ROW, LEFT PANEL, or RIGHT DETAIL. Describe what appears there and how it is arranged: exact title and labels, module order, images, grouping, and arrows. Write relationships explicitly, including the source and destination of branches, feedback loops, and cross-panel connections. Distinguish data flow from callouts or visual explanations. Use quoted text and equations where needed; text, formulas, arrows, and diagrams are all welcome in the preview.

## Plan the image assets explicitly

For newly designed previews, include meaningful image assets by default unless the user asks for a text-only, purely schematic, or other image-free design. A supplied reference also determines whether imagery belongs in the figure. Do not silently reduce an image-rich method into boxes and labels, or add unrelated decoration just to occupy space.

Specify each image where it belongs in the layout: its subject and action, scene or background, number of instances or sequence frames, viewpoint, crop or aspect ratio, relative size, and medium. Relevant assets may include photographic input/output examples, experimental scenes, isolated objects, softly shaded 3D models, or a short sequence of manipulation poses. Describe the actual visual content, rather than writing only "add an image" or "robot illustration".

For repeated subjects or successive states, say what stays the same and what changes. Keep subject identity, scene, viewpoint, object scale, lighting, and material treatment consistent when the method requires it. Allocate visible room for the images, not tiny placeholders. These same descriptions can later guide high-resolution asset generation or cropping from the preview.

Use user-supplied evidence for measured results, experimental images, data plots, and comparisons. Generated illustrative examples must not be presented as real experimental evidence. Preserve the supplied scientific modules and connections; do not invent methods or findings to complete the composition.

## Produce one ready-to-use prompt

Use direct drawing instructions such as "Place...", "Arrange...", "Show...", and "Connect...". Replace vague adjectives with specific visual choices. Keep the prompt as long as the figure requires, without adding an entire example case or a second planning report. English is useful when appropriate for the selected image tool; preserve the user's label language and exact wording.

A compact structure is:

```text
Create [figure subject and visual medium]. Use [canvas, background,
typography, palette, outlines, arrows, and density].

LAYOUT
[Major regions, proportions, reading direction, and alignment.]

[REGION POSITION — TITLE]
[Place and arrange the scientific modules, quoted labels, and image assets.
Describe asset subjects, counts, views, sizes, and repeated-state consistency.
Specify the arrows, branches, groups, and connections to other regions.]

[Repeat only for the regions this figure needs.]

VISUAL CONSISTENCY
[Color meanings, shared typography and imagery treatment, readable labels,
balanced spacing, full visibility, and scientific relationships to preserve.]
```

Replace every bracket with the actual figure specification. Save the finished prompt as `work/preview-prompt.md` in the task workspace (use a figure-specific filename for multiple figures), then submit that prompt with any relevant reference images to the image-generation tool. The file is the drawing prompt itself, not an approval form. Continue into the existing preview refinement and reconstruction steps without adding a mandatory pause.
