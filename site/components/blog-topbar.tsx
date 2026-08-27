import Link from "next/link";
import { assetUrl, copy, type Locale } from "@/lib/site";
import { LanguageSwitch } from "@/components/language-switch";

export function BlogTopBar({
  locale,
  active,
}: {
  locale: Locale;
  active?: "research";
}) {
  const t = copy[locale];
  // The gallery lives outside this Next app — it is the static site published
  // at the Pages root — so it is reached with a plain anchor, not next/link.
  const galleryHref = assetUrl("/") || "/";
  return (
    <header className="blog-topbar">
      <div className="blog-topbar-inner">
        <Link className="blog-wordmark" href={`/${locale}/blog`}>
          <span className="blog-wordmark-mark">ED</span>
          <span>{t.wordmark}</span>
        </Link>
        <nav className="blog-topbar-links" aria-label={t.research}>
          <Link
            className={active === "research" ? "is-active" : undefined}
            href={`/${locale}/blog`}
          >
            {t.research}
          </Link>
          <a href={galleryHref}>{t.gallery}</a>
          <LanguageSwitch locale={locale} />
        </nav>
      </div>
    </header>
  );
}
