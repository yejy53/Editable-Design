import { basePath, locales } from "@/lib/site";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

// A static export cannot rely on redirect(), which only resolves client-side
// and drops the base path. A meta refresh keeps /zh/ and /en/ working on
// GitHub Pages, including without JavaScript.
export default async function LocaleHome({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const target = `${basePath}/${locale}/blog/`;
  return (
    <>
      <meta httpEquiv="refresh" content={`0; url=${target}`} />
      <div className="root-redirect">
        <a href={target}>Editable Visual Design →</a>
      </div>
    </>
  );
}
