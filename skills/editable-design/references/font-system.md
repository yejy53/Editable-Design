# Font system

Read this when typography carries the design, when the brief needs a distinctive
editorial voice, or when the visual editor needs more useful alternatives than
the platform defaults.

## Two different counts

The **active type system** and the **editable font palette** are not the same.

- A finished poster normally uses two or three families: one display voice, one
  text voice, and optionally one utility or accent voice.
- The editor may expose three to five verified font variables so a user has
  meaningful alternatives. Do not use every exposed family in the composition.

For a poster, cover, flyer, or campaign, declare at least three meaningfully
different selectable font roles unless the brief deliberately specifies a
single-family identity. A body sans, another nearly identical sans, and the
same sans at a different weight are not three roles.

## Curated self-hosted kit

The optional font kit uses versioned Fontsource packages and local WOFF2 files.
Install it once:

```bash
scripts/install-font-kit.sh
```

Inspect the available design roles:

```bash
node scripts/font-kit.mjs list
```

Add only the selected families to a poster. The command copies the required
WOFF2 files and license into `assets/fonts/`, injects local `@font-face` rules,
and exposes a `--font-kit-*` variable to the editor:

```bash
node scripts/font-kit.mjs add editorial-serif index.html
node scripts/font-kit.mjs add clean-sans index.html
node scripts/font-kit.mjs add cjk-serif index.html
```

Available roles:

| ID | Voice | Best use |
| --- | --- | --- |
| `editorial-serif` | Fraunces Variable | expressive editorial and cultural headlines |
| `luxury-serif` | Bodoni Moda Variable | fashion, beauty, luxury, magazine covers |
| `clean-sans` | Instrument Sans Variable | refined campaigns and editorial body copy |
| `geometric-sans` | Space Grotesk Variable | technology, information, contemporary labels |
| `condensed-sans` | Roboto Condensed Variable | dense layouts, deck lines, prices, utilities |
| `experimental-display` | Unbounded Variable | art, music, youth, experimental display |
| `cjk-sans` | Noto Sans SC Variable | Chinese body copy, campaigns, information design |
| `cjk-serif` | Noto Serif SC Variable | Chinese editorial, culture, literature, premium display |
| `cjk-calligraphy` | Ma Shan Zheng | short Chinese handwritten accents and titles |
| `cjk-display` | ZCOOL XiaoWei | distinctive Chinese editorial display titles |

Self-hosted fonts are preferred when reproducibility matters. System fonts may
still be used when their exact voice is appropriate and `check-fonts.sh`
confirms they are installed.

## Pairing by contrast

Choose pairs that differ in structure, not merely in weight:

- luxury campaign: `luxury-serif` + `clean-sans`
- editorial or culture: `editorial-serif` + `clean-sans`
- technical information: `geometric-sans` + `condensed-sans`
- Chinese editorial: `cjk-serif` + `cjk-sans`, optionally a Latin display face
- Chinese expressive poster: `cjk-display` or `cjk-calligraphy` for short display
  copy, with `cjk-sans` or `cjk-serif` for everything longer
- experimental art: `experimental-display` + a quiet sans or serif

Do not set paragraphs in a display or calligraphic face. Do not use synthetic
bold or italics on CJK fonts that do not supply those styles. Mixed Chinese and
Latin display lines may use separate editable spans when the intended Latin
voice would otherwise disappear behind the CJK family.

## Shipping rules

- Use local relative font URLs only; never depend on Google Fonts or another
  runtime network request.
- Copy only fonts selected for the current design.
- Keep each copied `LICENSE.txt` with its font files.
- Run `scripts/check-fonts.sh index.html` after font injection and before render.
- Wait for `document.fonts.ready` before measuring, baking, or capturing.
