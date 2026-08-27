# Editable Visual Design — blog

The research blog for [Editable Visual Design](https://github.com/yejy53/Editable-Design),
built the same way as the [GenClaw-Next](https://yejy53.github.io/Genclaw-next-gallery/zh/blog/genclaw-next/)
research pages: a fully static Next.js export, bilingual (`zh` / `en`), with the
post itself authored as markdown.

This branch carries only the blog. The gallery site — `index.html`,
`player.html`, `gallery/` — stays on `main` and is copied into the deployment at
build time, so the published URLs are:

| URL | Served by |
| --- | --- |
| `/` | `main` (the gallery site, unchanged) |
| `/zh/blog/editable-design/` | this branch |
| `/en/blog/editable-design/` | this branch |
| `/zh/blog/`, `/en/blog/` | post index |

## Local development

```bash
cd site
npm install
npm run dev            # http://localhost:3000/zh/blog/editable-design/
```

Other scripts, all run from `site/`:

```bash
npm run build          # static export into site/out
npm run preview        # serve site/out on http://127.0.0.1:49174
npm run typecheck
npm run lint
```

Note that `npm run dev` serves the app at the domain root, so the gallery link
in the top bar (`/`) only resolves once the site is deployed next to `main`.

## Writing

The post is two markdown files, one per locale:

```
site/content/blog/editable-design.zh.md
site/content/blog/editable-design.en.md
```

Frontmatter drives the hero: `title`, `subtitle`, `summary`, `date`, `kicker`,
`ctaLabel` / `ctaHref`, `github`, `arxiv`, `tags`, and `draft: true` to keep a
post out of the index. A new post is just a new pair of files named
`<slug>.zh.md` / `<slug>.en.md`; the route and the index pick it up
automatically. When one locale is missing, the other is shown with a note.

Beyond normal markdown, the renderer adds one block type — a ` ```case ` fence —
which is what produces the media players:

````text
```case
mode: gallery          # gallery = thumbnail rail + one large stage
aspect: 7/6            # the frame; media is letterboxed inside it
item: | /blog/editable-design/editable-poster-edit.mp4
item: | /blog/editable-design/editable-dragon-year.mp4
caption: 图注
```
````

`mode: compare` lays the entries out side by side instead, and the text before
the first `|` on an `item` line becomes that cell's label:

````text
```case
mode: compare
aspect: 9/16
item: 扩散模型直出 · 一张位图 | /blog/editable-design/compare-diffusion.jpg
item: Editable Visual Design · HTML 结构 | /blog/editable-design/coded-artifact.jpg
```
````

Videos in a stage autoplay muted and loop, and keep native controls so a reader
can unmute; `.jpg` / `.png` items are treated as still media. An `item` with no
path renders as a reserved slot labelled "素材待补", so an unfinished section
still lays out. `[label](TODO)` marks a link whose target is still missing.

Pick `aspect` from the actual media ratios — the frame letterboxes rather than
crops, so the closest common ratio gives the narrowest bars. The asset list at
the top of each markdown file records every file's pixel size and ratio for
exactly this reason.

## Media

Published media lives in `site/public/blog/editable-design/` and is referenced
as `/blog/editable-design/<file>`. It is generated from local sources (the promo
video project, the tech-report figures, and the web-encoded editor captures)
that are not part of this repository:

```bash
./tools/build_assets.sh
```

Swapping one asset means overwriting the file under the same name — the markdown
does not need to change unless the ratio does.

## Deployment

`.github/workflows/deploy-blog.yml` runs on every push to `blog`: it builds the
static export, copies `main` in at the root, and publishes the result to GitHub
Pages.

One-time setup in the repository: **Settings → Pages → Build and deployment →
Source: GitHub Actions**. This replaces the current `gh-pages` branch
deployment; the gallery keeps working because `main` is copied into every
deployment. After a change to `main`, run the workflow again from the Actions
tab so the copied gallery is refreshed.

The base path is resolved automatically: `actions/configure-pages` reports the
path the site is served from, and it is passed to the build as
`NEXT_PUBLIC_BASE_PATH`. A project site (`https://<user>.github.io/<repo>/`)
therefore works without editing any configuration, and so does a user site or a
custom domain at the root.

### Alternative: keep the current gh-pages deployment

If switching the Pages source is not wanted, the blog can be published into a
subdirectory of the existing `gh-pages` branch instead. Build with the base path
set to the subdirectory and push only that folder:

```yaml
      - name: Build static export
        working-directory: site
        env:
          NEXT_PUBLIC_BASE_PATH: /Editable-Design/blog
        run: npm run build

      - name: Publish to gh-pages/blog
        uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: site/out
          publish_branch: gh-pages
          destination_dir: blog
          keep_files: true
```

The post then lives at `/Editable-Design/blog/zh/blog/editable-design/`, and the
"作品集 / Gallery" link in the top bar has to be pointed back at
`/Editable-Design/` by hand in `site/lib/site.ts`.

## Why paths are prefixed by hand

`next/link` applies the base path on its own, but raw `img` / `video` / `a`
targets do not. Published asset paths are therefore routed through `assetUrl()`
in `site/lib/site.ts`, and new code that points at anything under `/blog/`
should use it too.

`site/public/.nojekyll` is required: without it GitHub Pages runs Jekyll, which
skips underscore-prefixed directories and would drop the entire `_next/` bundle.

## Credits

The layout, the markdown pipeline, and the case-block player are carried over
from the GenClaw-Next visual archive
([yejy53/Genclaw-next-gallery](https://github.com/yejy53/Genclaw-next-gallery)),
trimmed down to the blog.
