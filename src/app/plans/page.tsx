import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { PlansList } from "@/features/plan/PlansList";

export const metadata: Metadata = { title: "My plans — Headroom" };

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  return <>
    <SiteHeader current="plans" />
    <main id="main"><PlansList deleted={deleted === "1"} /></main>
    <SiteFooter />
  </>;
}
