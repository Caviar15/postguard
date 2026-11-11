import { redirect, unstable_rethrow } from "next/navigation";
import { Dashboard } from "@/components/Dashboard";
import { clampDays } from "@/config";
import { buildDemoReport } from "@/demo/build";

export const dynamic = "force-dynamic";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; drafts?: string; refresh?: string }>;
}) {
  const params = await searchParams;
  const days = clampDays(params.days, 7);
  const includeDrafts = params.drafts === "1";
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
    redirect(`/demo?${next.toString()}`);
  }
  return <Dashboard report={report} basePath="/demo" />;
}
