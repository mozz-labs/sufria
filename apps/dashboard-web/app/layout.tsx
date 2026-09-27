import { IBM_Plex_Mono, IBM_Plex_Sans_Arabic } from "next/font/google";
import { designTokensCss } from "@sufria/shared";
import "./globals.css";

// Brief G §2: Plex Sans Arabic for text, Plex Mono for every number.
const sans = IBM_Plex_Sans_Arabic({
  variable: "--font-sans",
  subsets: ["arabic"],
  weight: ["400", "600", "700"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

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
