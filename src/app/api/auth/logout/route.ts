import { NextResponse } from "next/server";
import { safeNext } from "@/auth/next-path";
import { clearSession } from "@/auth/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await clearSession();
  // An optional in-app page to land on (the alerts page uses it to offer a different account). Default: home.
  const form = await request.formData().catch(() => null);
  const next = form?.get("next");
  const target = typeof next === "string" && next ? safeNext(next) : "/";
  return NextResponse.redirect(new URL(target, request.url), 303);
}
