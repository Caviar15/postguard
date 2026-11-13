import { NextResponse } from "next/server";
import { authorizeOwner, crossSite, denyOwner, isSameOrigin } from "@/alerts/owner";
import { armAlertSetup } from "@/auth/session";
import { storeFromEnv } from "@/alerts/deps";

export const dynamic = "force-dynamic";

/**
 * Step 1 of turning alerts on: the signed-in PostGuard session must belong to the alert owner's Buffer account.
 * That arms the sign-in that asks Buffer for the offline grant. No typed code.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return crossSite();
  const access = await authorizeOwner();
  if (access.status !== "owner") return denyOwner(request, access);
  // Only for the owner: anyone else learns nothing about what is configured.
  if (!storeFromEnv().configured) return NextResponse.redirect(new URL("/alerts/setup?problem=store", request.url), 303);
  await armAlertSetup(access.accountId);
  return NextResponse.redirect(new URL("/api/auth/start?watch=1", request.url), 303);
}
