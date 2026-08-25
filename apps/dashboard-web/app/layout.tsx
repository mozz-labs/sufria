import type { Metadata } from "next";
import { Almarai, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const almarai = Almarai({
  variable: "--font-heading",
  subsets: ["arabic"],
  weight: ["700", "800"],
  display: "swap",
});

const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-body",
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "لوحة تحكم المطعم",
  description: "استقبال وإدارة طلبات واتساب",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ar"
      dir="rtl"
      data-theme="light"
      className={`${almarai.variable} ${plexArabic.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
