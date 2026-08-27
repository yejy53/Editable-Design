import Link from "next/link";
import { assetUrl } from "@/lib/site";

export type Crumb = {
  label: string;
  href?: string;
  /** Set for a target outside the Next app — the gallery at the Pages root —
   *  where the base path is already applied and next/link must not add it. */
  raw?: boolean;
};

export function BlogHero({
  crumbs,
  title,
  titleSub,
  subtitle,
  deck,
  ctaLabel,
  ctaHref,
  github,
  arxiv,
  media,
  mediaAlt,
  note,
}: {
  crumbs: Crumb[];
  title: string;
  titleSub?: string | null;
  subtitle?: string | null;
  deck?: string | null;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  github?: string | null;
  arxiv?: string | null;
  media?: string | null;
  mediaAlt?: string;
  note?: string | null;
}) {
  const external = ctaHref ? /^https?:\/\//.test(ctaHref) : false;
  const hasLinks = Boolean(github || arxiv || (ctaLabel && ctaHref));

  const gallery = ctaLabel && ctaHref && (
    external ? (
      <a
        className="blog-paper-chip"
        href={ctaHref}
        rel="noopener noreferrer"
        target="_blank"
      >
        {ctaLabel}
      </a>
    ) : (
      <Link className="blog-paper-chip" href={ctaHref}>
        {ctaLabel}
      </Link>
    )
  );

  return (
    <section className="blog-hero">
      <div className="blog-hero-inner">
        <nav className="blog-breadcrumb" aria-label="Breadcrumb">
          <ol>
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <li key={`${crumb.label}-${index}`}>
                  {crumb.href && !last && crumb.raw ? (
                    <a href={crumb.href}>{crumb.label}</a>
                  ) : crumb.href && !last ? (
                    <Link href={crumb.href}>{crumb.label}</Link>
                  ) : (
                    <span aria-current={last ? "page" : undefined}>
                      {crumb.label}
                    </span>
                  )}
                  {!last && <span aria-hidden="true">/</span>}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="blog-title-block">
          <h1 className="blog-title">{title}</h1>
          {titleSub && <p className="blog-title-sub">{titleSub}</p>}
        </div>
        {subtitle && <p className="blog-subtitle">{subtitle}</p>}

        {hasLinks && (
          <div className="blog-paper-links" aria-label="Paper links">
            {github && (
              <a
                className="blog-paper-link"
                href={github}
                rel="noopener noreferrer"
                target="_blank"
              >
                GitHub
              </a>
            )}
            {github && arxiv && (
              <span className="blog-paper-sep" aria-hidden="true">
                ·
              </span>
            )}
            {arxiv && (
              <a
                className="blog-paper-link"
                href={arxiv}
                rel="noopener noreferrer"
                target="_blank"
              >
                arXiv
              </a>
            )}
            {gallery && (
              <>
                {(github || arxiv) && (
                  <span className="blog-paper-sep" aria-hidden="true">
                    ·
                  </span>
                )}
                {gallery}
              </>
            )}
          </div>
        )}

        {deck && <p className="blog-deck">{deck}</p>}
        {note && <p className="blog-fallback-note">{note}</p>}

        {media && (
          <figure className="blog-hero-media">
            {/* Static export serves the file as authored; next/image would
                only add an unoptimized wrapper here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={mediaAlt ?? ""} src={assetUrl(media)} />
          </figure>
        )}
      </div>
    </section>
  );
}
