// DEMO-ONLY: remove after Buffer Commit
import { buildDeps } from "@/alerts/deps";
import { handleSendNow } from "@/alerts/send-now";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Owner-triggered test send from /alerts/setup. Requires the setup code. */
export async function POST(request: Request) {
  return handleSendNow(request, buildDeps(request));
}
