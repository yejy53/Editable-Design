import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { copy, isLocale, locales, type Locale } from "@/lib/site";
import { getBlogIndex } from "@/lib/blog";
import { BlogTopBar } from "@/components/blog-topbar";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: copy[locale as Locale].research };
}

export default async function BlogIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const typedLocale = locale as Locale;
  const t = copy[typedLocale];
  const posts = getBlogIndex(typedLocale);

  return (
    <div className="blog-runtime" data-variant="x3">
      <BlogTopBar locale={typedLocale} active="research" />
      <div className="blog-page">
        <div className="blog-layout blog-index">
          <header className="blog-index-head">
            <p className="blog-index-eyebrow">{t.research}</p>
            <h1>{t.researchTitle}</h1>
            <p>{t.researchBody}</p>
          </header>

          {posts.length === 0 ? (
            <p className="blog-index-empty">{t.noPosts}</p>
          ) : (
            <div className="blog-index-list">
              {posts.map((post) => (
                <article className="blog-index-item" key={post.slug}>
                  <div className="blog-index-meta">
                    <span>{post.date}</span>
                    {post.kicker && <span>{post.kicker}</span>}
                  </div>
                  <div>
                    <h2>
                      <Link href={`/${typedLocale}/blog/${post.slug}`}>
                        {post.title}
                      </Link>
                    </h2>
                    {post.summary && <p>{post.summary}</p>}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
