import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Headroom — Plan your income. Protect your health-insurance subsidy.",
  description: "See how changing income affects your family's coverage—and compare what you can do next.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f6f4ee" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a className="skip-link" href="#main">Skip to content</a>{children}</body></html>;
}
