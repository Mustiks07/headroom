import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { Workspace } from "@/features/workspace/Workspace";
import { QuickOffer } from "@/features/start/QuickOffer";

export const metadata: Metadata = { title: "Check my subsidy — Headroom" };

export default async function CheckPage({ searchParams }: { searchParams: Promise<{ start?: string; doc?: string; pasted?: string; full?: string; household?: string }> }) {
  const { start, doc, pasted, full, household } = await searchParams;
  return <>
    <SiteHeader current="check" journey />
    <main id="main">{full !== "1" ? <QuickOffer intent={start === "project" ? "offer" : "income"} initialHouseholdId={household} importMode={pasted === "1" ? "pasted" : doc === "1" ? "doc" : undefined} /> : <Workspace seed={null} mode="own" entry={start === "project" ? "project" : undefined}
      initialStep={start === "project" ? "compare" : "household"} importMode={pasted === "1" ? "pasted" : doc === "1" ? "doc" : undefined} />}</main>
    <SiteFooter />
  </>;
}
