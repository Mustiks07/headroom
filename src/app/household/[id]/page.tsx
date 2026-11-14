import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { HouseholdPlanView } from "@/features/household-plan/HouseholdPlanView";

export const metadata: Metadata = { title: "Household plan — Headroom" };

export default async function HouseholdPlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  return <><SiteHeader current="plans" journey /><main id="main"><HouseholdPlanView id={decodeURIComponent(id)} justSaved={saved === "1"} /></main><SiteFooter /></>;
}
