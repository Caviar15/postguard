import { runCheck } from "@/alerts/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron calls this with `Authorization: Bearer ${CRON_SECRET}`. Read-only toward Buffer. */
export async function GET(request: Request) {
  const { status, body } = await runCheck(request);
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
