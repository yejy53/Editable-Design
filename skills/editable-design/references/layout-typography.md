# Layout and typography

Read this before writing HTML when the layout is unclear, and again when the
render is "correct everywhere but does not look designed". The "Shape the poster"
section of [SKILL.md](../SKILL.md) is the entry point.

A poster is read from a distance, scanned once, and taken in a fixed order.
Everything below serves that.

## Layout

**Hierarchy is the whole job.** A viewer should absorb a poster in three passes:
the hook, then the claim, then the detail. Build that staircase with size,
weight, colour, and white space, and make the steps genuinely different. Two
elements of similar visual weight compete and both lose. Emphasising everything
emphasises nothing.

**White space is structure, not what is left over.** Generous, deliberate margins
and gutters are the line between a designed poster and a filled one.

**Align to a grid.** Fix the margins and columns first, then place everything on
them. Optical alignment beats an offset you typed from memory; an edge that is
almost aligned reads as a mistake.

**Control the palette by role, not count.** Define the field, text, accent, and
semantic roles first. A restrained poster may need very few colours; a brand,
reference-led, or information-dense poster may need more. Every colour must
have a compositional or semantic job.

**Commit to one direction** — editorial, luxury, brutalist, playful, technical.
Pick one and let it drive every decision. A poster hedging between two reads as
neither.

**Anti-patterns:**

- Centring everything by default
- Equal spacing between unrelated blocks, flattening the hierarchy
- Text straight over busy artwork with no contrast treatment
- Borders, badges, and rules filling space in place of real structure
- Drop shadows and gradients patching a weak layout
- Marketplace styling: starbursts, unmotivated diagonal ribbons, clip art

A poster should look considered at full size and still read structurally as a
thumbnail.

## Working with the backdrop

Once the full-bleed backdrop exists, you are not laying out on white paper — you
are laying out on that image's bands.

- Text blocks land on the **flat** bands; the subject and the detail keep their own
- Let the text margins breathe with the image's composition; do not run type
  along the edge of the subject
- More than two levels of hierarchy inside one band wastes the flatness you
  asked the band for
- If the backdrop changes, revisit the layout. The same coordinates rarely hold
  on a different image

## Typography

Declare font stacks as custom properties on `:root` and reference them
throughout. Give every family a distinct job and valid script coverage. Add a
family when the brand, reference, script, or typographic contrast requires it,
not as decoration.

**Build a real size ramp.** display, headline, subhead, body, caption, each
clearly different from the last. A ramp with 10 percent steps reads as an error.

- Tighten tracking on large display type; open it slightly on small caps
- **A single-line block with `letter-spacing` needs `white-space: nowrap` or an
  explicit width.** CSS adds the tracking after the last character too, so the
  measured content width is a fraction wider than the glyphs need. Anything that
  later writes that measured width back — an editor converting the layout to
  absolute positioning, for instance — pushes the last character onto a second
  line. The block's height doubles and nothing reports an error
- Line height: 1.1–1.2 for display, 1.5–1.7 for body
- Keep poster body copy to 20–40 characters per line
- Do not run text to the edge; respect the margins you set
- Nothing below 9px after rendering. Small type is still meant to be read

## CJK typography

- **Choose a family that genuinely covers the script.** A Latin-only family must
  not set CJK text; use a CJK-capable family in that stack
- **No synthetic italics or synthetic bold.** Use a real weight, or another family
- **Weight is a choice of family, not only of `font-weight`.** Kai, running-script,
  and handwriting faces are structurally thin and stay thin at any size, so a
  headline set in one looks weightless however large. When a headline has to hold
  the page, take the weight from the family itself
- **CJK display type tolerates tight tracking; body copy does not**
- **In mixed settings put the Latin family first in the stack**, otherwise digits
  and roman characters inherit the CJK face's proportions

## Markup and CSS conventions

- **`* { box-sizing: border-box; }`**, always. `getBoundingClientRect()` reports
  the visual width including padding; under content-box, anything that writes that
  measured width back into `width` adds the padding a second time. A pill-shaped
  tag with `padding: 20px 44px` grows 88px wider every round trip, and nothing
  reports an error
- One file. CSS in a single `<style>` in the head. Zero external requests
- Palette and font stacks as `:root` custom properties, referenced throughout
- Layers absolutely positioned inside the canvas, so every coordinate is explicit
- Fixed px for every dimension, position, and gap that carries layout. No
  vw/vh/vmin/vmax/%. Decorative values — gradient stops, radii, shadow spread,
  texture `background-size` — are unrestricted
- Semantic class names describing the block's role on the poster
- Image paths relative to the poster file
- Never embed, print, or commit a key or credential
- **Do not write comments**
