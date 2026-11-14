import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { HouseholdList } from "@/features/household-plan/HouseholdList";

export const metadata: Metadata = { title: "Household plans — Headroom" };

export default async function HouseholdPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  return <><SiteHeader current="plans" /><main id="main"><HouseholdList deleted={deleted === "1"} /></main><SiteFooter /></>;
}
