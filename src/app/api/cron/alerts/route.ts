import { buildDeps } from "@/alerts/deps";
import { handleCron } from "@/alerts/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron calls this daily with `Authorization: Bearer ${CRON_SECRET}`. handleCron refuses to run when
 * CRON_SECRET is missing or the header does not match, and answers 5xx when the run failed.
 */
export async function GET(request: Request) {
  return handleCron(request, buildDeps(request));
}
