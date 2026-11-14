import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/SiteChrome";
import { PlanView } from "@/features/plan/PlanView";

export const metadata: Metadata = { title: "Your plan — Headroom" };

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  return <>
    <SiteHeader current="plans" />
    <main id="main"><PlanView id={decodeURIComponent(id)} justSaved={saved === "1"} /></main>
    <SiteFooter />
  </>;
}
