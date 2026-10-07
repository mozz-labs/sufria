import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import { DASHBOARD_UI_AR, designTokensCss } from "@sufria/shared";
import "./globals.css";

// Brief G §2: Plex Sans Arabic for text, Plex Mono for every number.
const sans = IBM_Plex_Sans_Arabic({
  variable: "--font-sans",
  subsets: ["arabic"],
  weight: ["400", "600", "700"],
  display: "swap",
});

// No generated fallback face for Mono (brief I-9 #1): next/font's is a local
// Arial, which has Arabic letters — it sat between Plex Mono and Plex Sans
// Arabic and drew «شيكل» and «منذ» inside every number. Both options: the
// webpack loader reads `adjustFontFallback`, Turbopack (next build) ignores it
// and drops the face only for an explicit `fallback`. The stack itself is
// `.num` in globals.css: Plex Mono, then Plex Sans Arabic, then monospace.
const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
  adjustFontFallback: false,
  fallback: [],
});

export const metadata: Metadata = {
  title: DASHBOARD_UI_AR.brand,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${sans.variable} ${mono.variable}`}>
      <head>
        {/* The colours, generated from packages/shared/src/design-tokens.ts. */}
        <style dangerouslySetInnerHTML={{ __html: designTokensCss() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
