export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];

// The repository that holds the gallery and the skill package.
export const codeRepoUrl = "https://github.com/yejy53/Editable-Design";

export const copy = {
  zh: {
    home: "首页",
    gallery: "作品集",
    archive: "作品集",
    research: "研究",
    researchTitle: "研究与技术记录",
    researchBody:
      "长文形式的方法说明、案例记录与实现笔记。正文限制在 760px，图表放宽到 1040px，脚注区再放宽到 1280px。",
    noPosts: "还没有公开的文章。",
    outline: "文章目录",
    pendingAsset: "素材待补",
    pendingLink: "链接待补",
    loading: "加载中",
    translationPending: "本篇尚无该语言版本，以下为原文。",
    prev: "上一个",
    next: "下一个",
    wordmark: "Editable Design",
  },
  en: {
    home: "Home",
    gallery: "Gallery",
    archive: "Gallery",
    research: "Research",
    researchTitle: "Research & Engineering Notes",
    researchBody:
      "Long-form method write-ups, case records, and implementation notes. Body text holds at 760px, media widens to 1040px, and the footnote zone widens again to 1280px.",
    noPosts: "No posts have been published yet.",
    outline: "Article sections",
    pendingAsset: "Asset pending",
    pendingLink: "Link pending",
    loading: "Loading",
    translationPending:
      "This post is not available in your language yet; the original is shown below.",
    prev: "Previous",
    next: "Next",
    wordmark: "Editable Design",
  },
} as const;

// Empty when served from the domain root. On a GitHub Pages project site the
// build lives under "/<repo>", and raw iframe/img/video/anchor targets are not
// rewritten by Next, so published asset paths need it applied by hand.
const rawBasePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").trim();
export const basePath = rawBasePath === "/" ? "" : rawBasePath.replace(/\/+$/, "");

export function assetUrl(path: string) {
  return path.startsWith("/") ? `${basePath}${path}` : path;
}

export function isLocale(value: string): value is Locale {
  return locales.includes(value as Locale);
}
