import { NextResponse } from "next/server";
import { authorizeOwner, crossSite, denyOwner, isSameOrigin } from "@/alerts/owner";
import { storeFromEnv } from "@/alerts/deps";

export const dynamic = "force-dynamic";

/**
 * Turns alerts off and deletes the stored Buffer tokens. The owner's account id stays on the record (it is not
 * a credential), so turning alerts off never hands ownership to the next visitor.
 */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return crossSite();
  const access = await authorizeOwner();
  if (access.status !== "owner") return denyOwner(request, access);
  try {
    await storeFromEnv().store.disable();
  } catch {
    return NextResponse.redirect(new URL("/alerts/setup?problem=store", request.url), 303);
  }
  return NextResponse.redirect(new URL("/alerts/setup?off=1", request.url), 303);
}
