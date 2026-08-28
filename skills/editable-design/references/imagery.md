# Imagery

Read this before writing any shipping-asset prompt, and again when generated
artwork comes back wrong: lettering appeared in the image, the composition does
not match its slot, a band that should be empty has objects in it, a cutout has
a dirty matte, or the crop does not fit its planned region. [SKILL.md](../SKILL.md)
owns asset topology, count, batching, and import policy; this reference owns
prompt construction and returned-image diagnostics.

## Reserved space: describe appearance only

Work out which regions text will cover, then **describe those regions purely by
their physical properties**:

```
WRONG: "leave clean dark negative space at the top for the headline"
RIGHT: "the top third is a continuous, low-detail, darker sky with no objects,
        symbols, borders, or high-contrast marks in it"
```

**Measured: naming the occupant produced an artefact 10 times out of 10;
describing appearance only, 0 times out of 13.** Holds across two scenes and two
framing nouns.

The trigger phrases are "for the headline", "space for the logo", "room for the
price", "space for copy". Tell the model something goes there and it draws
something — sometimes real lettering, sometimes an empty oval or bar. The second
is just as harmful: your HTML text lands on it and both become unreadable.

Say what the region **is**: sky, a wall, blurred foliage, flat shadow, an even
wash of paper — and that it is empty and uniform.

## A stated proportion is an intent, not a contract

Naming a share of the frame gets you a region of roughly that kind, not a region
of that size. Measured across two backdrops from the same model: one asked for a
clean right-hand 16 percent and got 22 percent; the other asked for 34 percent and
got **11**. Over-delivery and under-delivery, same wording pattern, same backend.

So never lay out against the number you asked for. Either measure the generated
backdrop before writing any coordinates — scan it in horizontal or vertical strips
and find where the ink actually starts — or leave far more margin than the layout
needs and accept the wasted space. A layout that survives only because the margin
happened to be generous was saved by luck, not by planning.

## Band phrasing

Describe a full-bleed backdrop as horizontal bands, one sentence each, giving
four things: position and share of the height, the material, the brightness, and
the detail density.

```
The composition reads as three horizontal bands.
Top 35 percent: an unbroken, even, pale grey-white fog sky, completely smooth
and uniform, no clouds, no birds, no sun disc, no objects, no marks, and no
high-contrast detail anywhere in it.
Middle band, about 37 percent of the height: layered ridgelines of tea terraces
receding into mist, dark blue-green silhouettes, soft atmospheric perspective,
the strongest detail of the whole frame concentrated here.
Bottom 28 percent: a flat, even wash of low-lying pale mist, extremely low
texture, uniform brightness, empty.
```

Two to four bands are both reasonable; let the layout decide. Bands that will
carry text need brightness well separated from the text colour. Bands that carry
no text are where the subject and the detail belong.

**Write the prompt in English even when the poster is in another language.**
Image models follow English more reliably and the prompt never appears in the
poster.

Note the difference between the "no clouds, no birds, no objects" above and a
negative instruction. Those clauses modify something already described
positively — they say how clean that fog sky is. "no text" modifies nothing.

## Negative instructions do not work

"no text, no lettering" has been measured to have no effect. Most current
image backends are not diffusion models: a diffusion model's negative prompt
genuinely subtracts a negative embedding inside CFG, whereas a multimodal model
generating an image has no such channel — the negation is just a few more tokens,
and models handle negation poorly to begin with.

Describing appearance is the mechanism that actually works.

## Size

**Use the size parameter when the tool has one; do not describe the frame in
prose.** A parameter is deterministic, prose is probabilistic.

- A full-bleed image gets the canvas proportions
- Slot artwork gets the slot's own dimensions
- If the tool only accepts an aspect ratio, give the ratio
- With no size control at all, the frame can only be implied in prose ("tall
  vertical portrait composition"), and the same prompt may return 1408x768 one
  time and 896x1200 the next. Expect to retry

When the returned image has the wrong proportions, crop it deliberately with
`object-fit` and `object-position`; never let it stretch. **Crop toward the bands
that carry no text** — keep the flat band the headline sits on and give up the
one nothing lands on.

## Transparent assets

Native transparency is an output control, not a visual prompt style. Follow the
active image-generation capability's transparency workflow. When the active
surface exposes a background parameter, pass `transparent` explicitly and use
PNG or WebP; do not rely on prompt wording alone. In the default Codex ImageGen
path, if no background parameter is exposed, ask for a genuinely transparent
background, never describe a checkerboard, preserve any returned alpha channel,
and treat the result as provisional until inspected.

Before importing a transparent asset, confirm that the file has an alpha channel
and that its empty corners are transparent. An RGB file that visibly contains a
checkerboard has baked pixels, not transparency. If the subject is correct but
the alpha check fails, do not spend another generation retry on the same subject:
use deterministic local alpha extraction when the edges permit it, or switch to
an explicitly authorized API/CLI path that can pass `background=transparent`.

Generate each independently movable cutout as its own file. One call containing
several separated subjects still returns one bitmap and does not create several
transparent assets.

Ask for a compact subject with room around it so it can be positioned and
cropped cleanly.

## Contrast where text sits over artwork

Use an explicit treatment sized to the text block: a solid panel, a scrim, or a
directional gradient. Do not count on the image being dark enough exactly where
you need it — change the scale and it no longer is.

Watch the edges of a scrim: the hard edge of a semi-transparent rectangle is
visible in the render. Either run it to the canvas edge or fade it out.

## Controllable and not

**Controllable**: the prose description, reference images (image-to-image and
local edits), cutouts, output size or ratio.

**Not controllable**: seed and reproducibility (the same prompt differs every
time; retrying is the only lever), negative prompts, or several independently
editable files from one built-in call.

Neither column depends on which image tool is behind it.
