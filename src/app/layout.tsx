import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Headroom — Before you say yes to a client offer",
  description: "See what a client offer leaves you after tax and health insurance, and which terms work.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2447F0" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="preload" href="/fonts/geist/Geist-Variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" /></head><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
