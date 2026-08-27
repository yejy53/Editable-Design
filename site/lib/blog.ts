import fs from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";
import { assetUrl, copy, locales, type Locale } from "./site";

const blogDir = path.join(process.cwd(), "content", "blog");

// "x3" is the quiet research-report treatment: sans-serif headings, 330/450
// weights, wide media. "classic" keeps the serif body at a larger size.
export type BlogVariant = "x3" | "classic";

export type BlogHeading = {
  id: string;
  text: string;
  depth: 2 | 3;
};

export type BlogPost = {
  slug: string;
  locale: Locale;
  /** Set when the requested locale has no file and another one was used. */
  fallbackLocale: Locale | null;
  variant: BlogVariant;
  title: string;
  /** Second title line, set smaller so a two-part title does not wrap dense. */
  subtitle: string | null;
  summary: string;
  /** Quieter second line under the hero lede; optional. */
  deck: string | null;
  date: string;
  kicker: string;
  hero: string | null;
  heroAlt: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  github: string | null;
  arxiv: string | null;
  tags: string[];
  draft: boolean;
  html: string;
  headings: BlogHeading[];
};

export type BlogSummary = Omit<BlogPost, "html" | "headings">;

type Frontmatter = Record<string, string>;

function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!match) return { data: {}, body: raw };

  const data: Frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: raw.slice(match[0].length) };
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripTags(html: string) {
  return html.replace(/<[^>]*>/g, "").trim();
}

// Latin headings collapse to "an-open-3t-class-model"; CJK headings keep their
// characters, which browsers resolve as anchors without extra encoding.
function slugify(text: string, used: Map<string, number>) {
  const base =
    text
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "section";
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

function isExternal(href: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("mailto:");
}

function isVideo(src: string) {
  return /\.(mp4|webm|mov|m4v)$/i.test(src);
}

type CaseEntry = {
  title: string;
  primary: string | null;
  secondary: string | null;
};

const CHEVRON_LEFT =
  '<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">' +
  '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg>';
const CHEVRON_RIGHT =
  '<svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">' +
  '<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"/></svg>';

function mediaTag(src: string, alt: string, ratio = "", stage = false) {
  const url = escapeAttribute(assetUrl(src));
  if (isVideo(src)) {
    // Stage videos autoplay (muted — required by browsers), loop, and keep
    // native controls so the reader can unmute. Thumbnails stay still frames.
    return (
      `<video class="blog-case-media" src="${url}"${ratio}` +
      `${stage ? " autoplay controls" : ""} muted loop playsinline` +
      ` preload="${stage ? "auto" : "metadata"}"></video>`
    );
  }
  return (
    `<img class="blog-case-media" src="${url}" alt="${escapeAttribute(alt)}"` +
    `${ratio} loading="lazy" decoding="async" />`
  );
}

function loadingMark(label: string) {
  return (
    `<div class="blog-case-loading" aria-hidden="true">` +
    `<span class="blog-case-loading-spin"></span>` +
    `<span class="blog-case-loading-text">${escapeAttribute(label)}</span></div>`
  );
}

function caseCell(
  title: string,
  src: string | null,
  aspect: string,
  pendingLabel: string,
  loadingLabel: string
) {
  const heading = title
    ? `<p class="blog-case-title">${escapeAttribute(title)}</p>`
    : "";
  const ratio = ` style="aspect-ratio:${escapeAttribute(aspect)}"`;

  if (!src) {
    return (
      `<div class="blog-case-cell">${heading}` +
      `<div class="blog-case-slot"${ratio}>` +
      `<span class="blog-case-slot-mark">${escapeAttribute(pendingLabel)}</span>` +
      `<span class="blog-case-slot-ratio">${escapeAttribute(
        aspect.replace("/", " : ")
      )}</span></div></div>`
    );
  }

  // Frame keeps the authored aspect as a letterbox; media uses object-fit:
  // contain so ultra-wide captures are never side-cropped.
  if (isVideo(src)) {
    return (
      `<div class="blog-case-cell">${heading}` +
      `<div class="blog-case-stage-frame" data-loading="true"${ratio}>` +
      `${loadingMark(loadingLabel)}${mediaTag(src, title, "", true)}` +
      `</div></div>`
    );
  }

  return (
    `<div class="blog-case-cell">${heading}` +
    `<div class="blog-case-stage-frame" data-loading="false"${ratio}>` +
    `${mediaTag(src, title, "", true)}</div></div>`
  );
}

/**
 * A ```case fence is a media block that survives being empty: every slot
 * renders as a reserved frame until an `item` gains a path.
 *
 *     ```case
 *     label: Case 01
 *     aspect: 16/10
 *     labelA: 有素材
 *     labelB: 纯代码
 *     item: 网页 | /blog/x/web-rich.png | /blog/x/web-plain.png
 *     item: 海报 | /blog/x/poster.mp4
 *     caption: 图注
 *     note: 占位说明，只在素材缺席时显示
 *     ```
 *
 * `mode: gallery` (the default past two entries) puts a scrollable thumbnail
 * rail above one large stage; `mode: compare` lays the entries out side by side.
 * A third field on `item` turns that entry into a two-up inside the stage,
 * labelled by `labelA` / `labelB`.
 */
type CaseLabels = {
  pending: string;
  prev: string;
  next: string;
  loading: string;
};

function renderCaseBlock(source: string, labels: CaseLabels, id: string) {
  const pendingLabel = labels.pending;
  const loadingLabel = labels.loading;
  const meta: Record<string, string> = {};
  const entries: CaseEntry[] = [];

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key === "item") {
      const [title, primary, secondary] = value.split("|").map((p) => p.trim());
      entries.push({
        title: title ?? "",
        primary: primary || null,
        secondary: secondary || null,
      });
    } else {
      meta[key] = value;
    }
  }

  if (entries.length === 0) {
    entries.push({
      title: meta.title ?? "",
      primary: meta.src ?? null,
      secondary: null,
    });
  }

  const aspect = meta.aspect ?? "16/10";
  const note = meta.note ?? "";
  const mode =
    meta.mode === "compare" || meta.mode === "gallery"
      ? meta.mode
      : entries.length > 2
        ? "gallery"
        : "compare";

  const label = meta.label
    ? `<p class="blog-case-label">${escapeAttribute(meta.label)}</p>`
    : "";
  // The note describes what is still missing, so it goes once per block and
  // disappears as soon as every slot has an asset.
  const pendingNote =
    note &&
    entries.some(
      (entry) => !entry.primary || (Boolean(meta.labelB) && !entry.secondary)
    )
      ? `<p class="blog-case-note">${escapeAttribute(note)}</p>`
      : "";
  const caption = meta.caption
    ? `<figcaption>${escapeAttribute(meta.caption)}</figcaption>`
    : "";

  if (mode === "compare") {
    const cells = entries
      .map((entry) =>
        caseCell(entry.title, entry.primary, aspect, pendingLabel, loadingLabel)
      )
      .join("");
    return (
      `<figure class="blog-case" data-mode="compare" data-columns="${entries.length}">` +
      `${label}<div class="blog-case-grid">${cells}</div>${pendingNote}${caption}` +
      `</figure>\n`
    );
  }

  const thumbs = entries
    .map((entry, index) => {
      const name = entry.title || `${index + 1}`;
      const thumbRatio = ` style="aspect-ratio:${escapeAttribute(aspect)}"`;
      const inner = entry.primary
        ? mediaTag(entry.primary, name, "", false)
        : `<span class="blog-case-thumb-empty">${String(index + 1).padStart(
            2,
            "0"
          )}</span>`;
      // Labels stay off the rail — Kimi-style is media only. Title is kept as
      // an aria-label so the tab is still named for assistive tech.
      return (
        `<button class="blog-case-thumb" type="button" role="tab"` +
        ` id="${id}-tab-${index}" aria-controls="${id}-panel-${index}"` +
        ` aria-label="${escapeAttribute(name)}"` +
        ` aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}"` +
        ` data-index="${index}">` +
        `<span class="blog-case-thumb-frame" data-empty="${!entry.primary}"${thumbRatio}>${inner}</span>` +
        `</button>`
      );
    })
    .join("");

  // Every panel ships in the HTML with all but the first hidden, so the block
  // still shows an entry when the hydration script never runs. Gallery stage
  // is always a single media slot — no left/right compare chrome.
  const panels = entries
    .map((entry, index) => {
      const cell = caseCell(
        "",
        entry.primary,
        aspect,
        pendingLabel,
        loadingLabel
      );
      return (
        `<div class="blog-case-panel" role="tabpanel" id="${id}-panel-${index}"` +
        ` aria-labelledby="${id}-tab-${index}"${index === 0 ? "" : " hidden"}>` +
        `<div class="blog-case-panel-media" data-columns="1">${cell}</div></div>`
      );
    })
    .join("");

  return (
    `<figure class="blog-case" data-mode="gallery">` +
    `<div class="blog-case-rail-wrap">` +
    `<div class="blog-case-rail" role="tablist" aria-label="${escapeAttribute(
      meta.label || "gallery"
    )}">${thumbs}</div>` +
    `<button class="blog-case-rail-nav" type="button" data-dir="prev" aria-label="${escapeAttribute(
      labels.prev
    )}" disabled>${CHEVRON_LEFT}</button>` +
    `<button class="blog-case-rail-nav" type="button" data-dir="next" aria-label="${escapeAttribute(
      labels.next
    )}">${CHEVRON_RIGHT}</button>` +
    `</div><div class="blog-case-stage">${panels}</div>` +
    `${pendingNote}${caption}</figure>\n`
  );
}

function renderMarkdown(body: string, locale: Locale) {
  const headings: BlogHeading[] = [];
  const used = new Map<string, number>();
  const marked = new Marked({ gfm: true });
  const t = copy[locale];
  let caseCount = 0;

  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inline = this.parser.parseInline(tokens);
        const plain = stripTags(inline);
        // `## Footnotes {#footnotes}` pins an id, which non-latin headings need
        // because the layout keys its wide footnote zone off `#footnotes`.
        const explicit = /\{#([^}\s]+)\}\s*$/.exec(plain);
        const text = explicit ? plain.slice(0, explicit.index).trim() : plain;
        const id = explicit ? explicit[1] : slugify(text, used);
        if (depth === 2 || depth === 3) {
          headings.push({ id, text, depth });
        }
        const body = explicit
          ? inline.replace(/\{#[^}\s]+\}\s*$/, "").trimEnd()
          : inline;
        return `<h${depth} id="${escapeAttribute(id)}">${body}</h${depth}>\n`;
      },

      image({ href, title, text }) {
        const src = escapeAttribute(assetUrl(href));
        const alt = escapeAttribute(text ?? "");
        const caption = title ? ` data-caption="${escapeAttribute(title)}"` : "";
        return `<img src="${src}" alt="${alt}" loading="lazy" decoding="async"${caption} />`;
      },

      // A paragraph holding nothing but an image becomes a figure, so a
      // markdown title (`![alt](src "caption")`) turns into a real caption.
      paragraph({ tokens }) {
        const first = tokens.length === 1 ? tokens[0] : null;
        if (first && first.type === "image") {
          const only = first as Tokens.Image;
          const figcaption = only.title
            ? `<figcaption>${escapeAttribute(only.title)}</figcaption>`
            : "";
          return `<figure class="blog-media">${this.image(
            only
          )}${figcaption}</figure>\n`;
        }
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },

      code({ text, lang }) {
        if (lang === "case") {
          caseCount += 1;
          return renderCaseBlock(
            text,
            {
              pending: t.pendingAsset,
              prev: t.prev,
              next: t.next,
              loading: t.loading,
            },
            `case-${caseCount}`
          );
        }
        const className = lang ? ` class="language-${escapeAttribute(lang)}"` : "";
        return `<pre><code${className}>${escapeAttribute(text)}</code></pre>\n`;
      },

      link({ href, title, tokens }) {
        const inline = this.parser.parseInline(tokens);
        // `[label](TODO)` marks a link that is still missing its target, so the
        // gap is visible on the page instead of shipping as a dead anchor.
        if (href === "TODO" || href.toLowerCase().startsWith("todo:")) {
          return `<span class="blog-link-pending" title="${escapeAttribute(
            t.pendingLink
          )}">${inline}</span>`;
        }
        const url = escapeAttribute(isExternal(href) ? href : assetUrl(href));
        const label = title ? ` title="${escapeAttribute(title)}"` : "";
        const target = isExternal(href)
          ? ' target="_blank" rel="noopener noreferrer"'
          : "";
        return `<a href="${url}"${label}${target}>${inline}</a>`;
      },
    },
  });

  const html = marked.parse(body, { async: false }) as string;

  // Wide tables need their own scroll container; markdown cannot nest them,
  // so a string pass is enough and keeps the renderer override small.
  const withTables = html
    .replace(/<table>/g, '<div class="blog-table">\n<table>')
    .replace(/<\/table>/g, "</table>\n</div>");

  return { html: withTables, headings };
}

function readFileFor(slug: string, locale: Locale) {
  const candidates = [
    path.join(blogDir, `${slug}.${locale}.md`),
    path.join(blogDir, `${slug}.md`),
    ...locales.map((other) => path.join(blogDir, `${slug}.${other}.md`)),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const usedLocale = /\.(zh|en)\.md$/.exec(file)?.[1] as Locale | undefined;
    return {
      raw: fs.readFileSync(file, "utf8"),
      fallbackLocale:
        usedLocale && usedLocale !== locale ? usedLocale : null,
    };
  }
  return null;
}

function toVariant(value: string | undefined): BlogVariant {
  return value === "classic" ? "classic" : "x3";
}

export function getBlogSlugs(): string[] {
  if (!fs.existsSync(blogDir)) return [];
  const slugs = new Set<string>();
  for (const entry of fs.readdirSync(blogDir)) {
    if (!entry.endsWith(".md")) continue;
    slugs.add(entry.replace(/\.(zh|en)\.md$/, "").replace(/\.md$/, ""));
  }
  return [...slugs].sort();
}

export function getBlogPost(slug: string, locale: Locale): BlogPost | null {
  const file = readFileFor(slug, locale);
  if (!file) return null;

  const { data, body } = parseFrontmatter(file.raw);
  const { html, headings } = renderMarkdown(body.trim(), locale);

  return {
    slug,
    locale,
    fallbackLocale: file.fallbackLocale,
    variant: toVariant(data.variant),
    title: data.title ?? slug,
    subtitle: data.subtitle ?? null,
    summary: data.summary ?? "",
    deck: data.deck ?? null,
    date: data.date ?? "",
    kicker: data.kicker ?? (locale === "zh" ? "研究" : "Research"),
    hero: data.hero ?? null,
    heroAlt: data.heroAlt ?? data.title ?? slug,
    ctaLabel: data.ctaLabel ?? null,
    ctaHref: data.ctaHref ?? null,
    github: data.github ?? null,
    arxiv: data.arxiv ?? null,
    tags: (data.tags ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    draft: data.draft === "true",
    html,
    headings,
  };
}

export function getBlogIndex(locale: Locale): BlogSummary[] {
  return getBlogSlugs()
    .map((slug) => getBlogPost(slug, locale))
    .filter((post): post is BlogPost => post !== null && !post.draft)
    .map((post) => ({
      slug: post.slug,
      locale: post.locale,
      fallbackLocale: post.fallbackLocale,
      variant: post.variant,
      title: post.title,
      subtitle: post.subtitle,
      summary: post.summary,
      deck: post.deck,
      date: post.date,
      kicker: post.kicker,
      hero: post.hero,
      heroAlt: post.heroAlt,
      ctaLabel: post.ctaLabel,
      ctaHref: post.ctaHref,
      github: post.github,
      arxiv: post.arxiv,
      tags: post.tags,
      draft: post.draft,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
