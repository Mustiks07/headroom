import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { StartChooser } from "@/features/start/StartChooser";

export const metadata: Metadata = { title: "Start — Headroom" };

export default async function StartPage({ searchParams }: { searchParams: Promise<{ intent?: string }> }) {
  const { intent } = await searchParams;
  return <><SiteHeader /><main id="main"><StartChooser intent={intent === "year" ? "year" : "offer"} /></main><SiteFooter /></>;
}
