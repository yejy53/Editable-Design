import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

// Variable weights are what let the research-post layout sit at 330/450
// instead of snapping to 300/400/500. See app/fonts/README.md for provenance.
const misans = localFont({
  src: "./fonts/MiSansVF.woff2",
  weight: "100 900",
  variable: "--font-misans",
  display: "swap",
});

// Self-hosted so the static build does not depend on fonts.gstatic.com at
// compile time. Used by the footnote zone and the serif "classic" variant.
const lora = localFont({
  src: "./fonts/LoraVF.woff2",
  weight: "400 700",
  variable: "--font-lora",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Editable Visual Design",
    template: "%s · Editable Visual Design",
  },
  description:
    "Coding-agent-driven creation of editable, tastefully crafted visual artifacts.",
};

// Runs before first paint so a stored dark choice never flashes light first.
// Light is the default when nothing has been chosen.
const themeScript = `(function(){try{var t=localStorage.getItem("editable-design-theme");if(t!=="light"&&t!=="dark")t="light";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="light"}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${playfair.variable} ${misans.variable} ${lora.variable}`}
      data-theme="light"
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
