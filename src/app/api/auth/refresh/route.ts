import { NextResponse } from "next/server";
import { refreshAccessToken } from "@/auth/oauth";
import { clearSession, readSession, writeSession } from "@/auth/session";
import { getConfig } from "@/config";

export const dynamic = "force-dynamic";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export async function GET(request: Request) {
  const nextPath = safeNext(new URL(request.url).searchParams.get("next"));
  const session = await readSession();
  if (!session) return NextResponse.redirect(new URL("/?auth_error=session", request.url));
  const config = getConfig();
  try {
    const tokens = await refreshAccessToken({
      refreshToken: session.refreshToken,
      clientId: config.clientId,
      clientSecret: config.clientSecret || undefined,
    });
    await writeSession(tokens);
    return NextResponse.redirect(new URL(nextPath, request.url));
  } catch (error) {
    await clearSession();
    const message = error instanceof Error ? error.message : "refresh_failed";
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(message)}`, request.url));
  }
}
