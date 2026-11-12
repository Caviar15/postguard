import { redirect, unstable_rethrow } from "next/navigation";
import { Dashboard } from "@/components/Dashboard";
import { clampDays } from "@/config";
import { PRIORITIES } from "@/domain/readiness";
import type { Priority } from "@/domain/types";
import { buildDemoReport } from "@/demo/build";

export const dynamic = "force-dynamic";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; drafts?: string; refresh?: string; sort?: string; filter?: string }>;
}) {
  const params = await searchParams;
  const days = clampDays(params.days, 7);
  const includeDrafts = params.drafts === "1";
  const initialSort = params.sort === "time" ? "time" : "priority";
  const initialFilter = PRIORITIES.includes(params.filter as Priority) ? (params.filter as Priority) : "all";
  let report;
  try {
    report = await buildDemoReport(new Date(), days, includeDrafts);
  } catch (error) {
    unstable_rethrow(error);
    throw error;
  }
  if (params.refresh === "1") {
    const next = new URLSearchParams({ days: String(days) });
    if (includeDrafts) next.set("drafts", "1");
    if (initialSort === "time") next.set("sort", "time");
    if (initialFilter !== "all") next.set("filter", initialFilter);
    redirect(`/demo?${next.toString()}`);
  }
  return <Dashboard report={report} basePath="/demo" initialSort={initialSort} initialFilter={initialFilter} />;
}
