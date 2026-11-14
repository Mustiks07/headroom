import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { Workspace } from "@/features/workspace/Workspace";

export const metadata: Metadata = { title: "Check my subsidy — Headroom" };

export default async function CheckPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  return <>
    <SiteHeader current="check" />
    <main id="main"><Workspace seed={null} mode="own" entry={start === "project" ? "project" : undefined} /></main>
    <SiteFooter />
  </>;
}
