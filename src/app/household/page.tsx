import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { HouseholdList } from "@/features/household-plan/HouseholdList";

export const metadata: Metadata = { title: "Household plans — Headroom" };

export default function HouseholdPage() {
  return <><SiteHeader current="plans" /><main id="main"><HouseholdList /></main><SiteFooter /></>;
}
