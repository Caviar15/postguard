import { NextResponse } from "next/server";
import { hasSecretValue } from "@/alerts/gate";
import { storeFromEnv } from "@/alerts/deps";

export const dynamic = "force-dynamic";

/** Turns alerts off and deletes the stored Buffer token. Same code check as turning them on. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const code = typeof form?.get("code") === "string" ? String(form?.get("code")) : "";
  if (!hasSecretValue(code, process.env)) return NextResponse.redirect(new URL("/alerts/setup?problem=code", request.url), 303);
  try {
    await storeFromEnv().store.disable();
  } catch {
    return NextResponse.redirect(new URL("/alerts/setup?problem=store", request.url), 303);
  }
  return NextResponse.redirect(new URL("/alerts/setup?off=1", request.url), 303);
}
