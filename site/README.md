# How to hacking Design Arena: What Makes Generated Websites Fascinating?

This is the only article published by this site, in Chinese and English. The
older Editable Visual Design introduction from the historical `blog` branch
is not included. The framework was adapted from that branch.

- Chinese source: `content/blog/genclaw-next.zh.md`
- English source: `content/blog/genclaw-next.en.md`
- Shared media: `public/blog/genclaw-next/`
- Original article: <https://yejy53.github.io/Genclaw-next-gallery/zh/blog/genclaw-next/>

The article describes simplified, exploratory simulations, not official Design
Arena results or a rigorous reproduction. Both languages include the same scope
note and chart qualifications. The five charts have separate Chinese and English exports imported from the
provided arena-charts sources. The single-pass image-count label is corrected
to distinguish image references from image-generation calls. Arithmetic and
bilingual consistency were checked; raw experimental records were not supplied.
See `../notes/blog-chart-audit.md` for unresolved interpretation issues and
`../tools/blog-charts/` for rendering sources. Numerical results were not refitted.

## Local development

```sh
cd site
npm ci
npm run dev
```

Open `/zh/blog/genclaw-next/` or `/en/blog/genclaw-next/` on the development server.

## Production verification

From `site/`:

```sh
NEXT_PUBLIC_BASE_PATH=/Editable-Design NEXT_TELEMETRY_DISABLED=1 npm run build
npm run typecheck
npm run lint
node scripts/assemble-pages.mjs
```

Serve the resulting `site-dist/` directory at `/Editable-Design/` when testing
the production build. Serving it at the domain root will break prefixed assets.
The assembler includes only the blog export and the existing `index.html`,
`player.html`, `assets/`, and `gallery/`. It excludes skills and local experiments.

## Deployment

The existing Pages site publishes from `gh-pages`. The `main` branch keeps the
source, original gallery, and both translations together. The read-only
`.github/workflows/build-site.yml` workflow checks and assembles an artifact;
it does not change the repository's Pages settings.

After building and checking the combined site, commit and push the reviewed
source to `main`, then publish the assembled files through the existing SSH
remote:

```sh
node site/scripts/publish-pages.mjs
```

Run that command from the repository root. It verifies the source matches
`origin/main`, creates a deployment commit with the existing `gh-pages` head as
its parent, and performs a normal fast-forward push. It neither switches the
working branch nor modifies its index. GitHub's existing Pages workflow then
publishes the branch. Do not run the historical `blog` branch workflow: the new
article is maintained on `main`.

The deployed article paths are:

- `/Editable-Design/zh/blog/genclaw-next/`
- `/Editable-Design/en/blog/genclaw-next/`

The existing root gallery, player, and gallery asset URLs remain unchanged.
The Genclaw-next-gallery repository is not a deployment target.

## README preview

`node scripts/preview-readme.mjs /tmp/editable-design-blog-preview/review`
generates a local GitHub-style approximation of README and the Paper Fig guide.
The preview links the blog to the local `/Editable-Design/` production build.
This preview is not included in the Pages deployment artifact.
