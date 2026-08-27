# Fonts

## MiSansVF.woff2

A variable-weight (100–900) sans that covers Latin and simplified Chinese. The
research-post layout in `app/blog.css` depends on non-standard weights (330 for
body, 450 for headings), which only a variable font can hit.

MiSans is published by Xiaomi and free to use, including commercially. The copy
here is a web subset; for the complete family, download the official release
from Xiaomi (<https://hyperos.mi.com/font/>) and replace this file, keeping the
`weight: "100 900"` declaration in `app/layout.tsx`.

If the file is removed, `--font-misans` falls through to the system sans stack
declared in `app/blog.css`. Layout stays intact, but the 330 weight rounds to
the nearest static weight the system font provides.

## LoraVF.woff2

A variable-weight Lora (400–700) subset, self-hosted so `next build` does not
need to reach fonts.gstatic.com. Used for the footnote zone and for the
`classic` post variant. Source family: [Lora (OFL)](https://github.com/google/fonts/tree/main/ofl/lora).
