import { buildDeps } from "@/alerts/deps";
import { handleUnsubscribe } from "@/alerts/run";

export const dynamic = "force-dynamic";

/** GET shows a confirmation page and changes nothing. POST unsubscribes (RFC 8058 one-click). */
export async function GET(request: Request) {
  return handleUnsubscribe(request, buildDeps(request));
}

export async function POST(request: Request) {
  return handleUnsubscribe(request, buildDeps(request));
}
