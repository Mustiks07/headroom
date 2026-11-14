import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Headroom — Plan your income. Protect your health subsidy.",
  description: "Understand how freelance income affects your health-insurance subsidy and compare your next steps.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
