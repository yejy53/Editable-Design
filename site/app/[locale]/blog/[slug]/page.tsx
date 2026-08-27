import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { assetUrl, copy, isLocale, locales, type Locale } from "@/lib/site";
import { getBlogPost, getBlogSlugs } from "@/lib/blog";
import { BlogTopBar } from "@/components/blog-topbar";
import { BlogHero } from "@/components/blog-hero";
import { BlogOutline } from "@/components/blog-outline";
import { BlogGalleries } from "@/components/blog-galleries";

export function generateStaticParams() {
  return locales.flatMap((locale) =>
    getBlogSlugs().map((slug) => ({ locale, slug }))
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const post = getBlogPost(slug, locale as Locale);
  if (!post) return {};
  return {
    title: post.title,
    description: post.summary || undefined,
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const typedLocale = locale as Locale;
  const post = getBlogPost(slug, typedLocale);
  if (!post) notFound();
  const t = copy[typedLocale];

  return (
    <div className="blog-runtime" data-variant={post.variant}>
      <BlogTopBar locale={typedLocale} active="research" />
      <div className="blog-page">
        <div className="blog-layout">
          <BlogHero
            crumbs={[
              { label: t.home, href: assetUrl("/") || "/", raw: true },
              { label: t.research, href: `/${typedLocale}/blog` },
              { label: post.title },
            ]}
            title={post.title}
            titleSub={post.subtitle}
            subtitle={post.summary}
            deck={post.deck}
            note={post.fallbackLocale ? t.translationPending : null}
            ctaLabel={post.ctaLabel}
            ctaHref={post.ctaHref}
            github={post.github}
            arxiv={post.arxiv}
            media={post.hero}
            mediaAlt={post.heroAlt}
          />
          <div className="blog-main">
            <article
              className="markdown"
              dangerouslySetInnerHTML={{ __html: post.html }}
            />
            <BlogGalleries />
          </div>
        </div>
      </div>
      <BlogOutline headings={post.headings} label={t.outline} />
    </div>
  );
}
