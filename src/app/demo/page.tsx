import { Dashboard } from "@/components/Dashboard";
import { clampDays } from "@/config";
import { buildDemoReport } from "@/demo/build";

export const dynamic = "force-dynamic";

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const params = await searchParams;
  const days = clampDays(params.days, 7);
  const report = await buildDemoReport(new Date(), days);
  return <Dashboard report={report} basePath="/demo" />;
}
