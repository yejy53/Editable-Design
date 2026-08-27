"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import type { Locale } from "@/lib/site";

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const router = useRouter();

  const switchTo = useCallback(
    (next: Locale) => {
      if (next === locale) return;
      const segments = (pathname ?? "/").split("/");
      if (segments[1] === "zh" || segments[1] === "en") {
        segments[1] = next;
      } else {
        segments.splice(1, 0, next);
      }
      router.push(segments.join("/") || `/${next}`);
    },
    [locale, pathname, router]
  );

  return (
    <div className="language-switch" role="group" aria-label="Language">
      <button
        type="button"
        className={locale === "zh" ? "is-active" : undefined}
        onClick={() => switchTo("zh")}
      >
        中文
      </button>
      <span aria-hidden="true">/</span>
      <button
        type="button"
        className={locale === "en" ? "is-active" : undefined}
        onClick={() => switchTo("en")}
      >
        EN
      </button>
    </div>
  );
}
