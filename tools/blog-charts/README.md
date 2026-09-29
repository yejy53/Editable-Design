# Blog chart sources

Imported from the user-provided `arena-charts` folder. Both locales are generated
from the same summary constants in `make_statics.py`. This is a presentation
script, not an evaluation pipeline or an implementation of rating estimation.
See [the audit](../../notes/blog-chart-audit.md) before interpreting the numbers.

```sh
python3 tools/blog-charts/make_statics.py --html-only
```

HTML files are written to `rendered/{zh,en}`. The optional PNG renderer in the
source uses Python Playwright with Chromium and exports at 3× scale. Published
PNGs live in `site/public/blog/genclaw-next/charts/{zh,en}`.

The imported static PNGs are retained except for the two single-pass figures,
which are re-rendered at 1000 px for this preview with corrected image-reference
labels (the other imported PNGs are 3000 px). Numerical values
and model order are unchanged. The README embeds the author-provided Chinese animation unchanged at
`assets/blog/oneshot-board-zh.gif`; its caption clarifies that the original
“生图” labels count images used per page rather than image-generation tool calls.
