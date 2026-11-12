import { NextResponse } from "next/server";
import { hasSecretValue } from "@/alerts/gate";
import { armAlertSetup } from "@/auth/session";
import { storeFromEnv } from "@/alerts/deps";

export const dynamic = "force-dynamic";

/** Step 1 of turning alerts on: prove you hold CRON_SECRET, then continue to the Buffer sign-in. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const code = typeof form?.get("code") === "string" ? String(form?.get("code")) : "";
  if (!hasSecretValue(code, process.env)) return NextResponse.redirect(new URL("/alerts/setup?problem=code", request.url), 303);
  // Only after the code is right: a visitor without it learns nothing about what is configured.
  if (!storeFromEnv().configured) return NextResponse.redirect(new URL("/alerts/setup?problem=store", request.url), 303);
  await armAlertSetup();
  return NextResponse.redirect(new URL("/api/auth/start?watch=1", request.url), 303);
}
