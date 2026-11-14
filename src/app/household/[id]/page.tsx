import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { HouseholdPlanView } from "@/features/household-plan/HouseholdPlanView";

export const metadata: Metadata = { title: "Household plan — Headroom" };

export default async function HouseholdPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <><SiteHeader current="plans" /><main id="main"><HouseholdPlanView id={decodeURIComponent(id)} /></main><SiteFooter /></>;
}
