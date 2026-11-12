import { NextResponse } from "next/server";
import { nextAuthStep } from "@/auth/flow";
import { safeNext } from "@/auth/next-path";
import { refreshAccessToken } from "@/auth/oauth";
import { clearSession, readSession, writeSession } from "@/auth/session";
import { getConfig } from "@/config";

export const dynamic = "force-dynamic";

function reconnect(request: Request): NextResponse {
  return NextResponse.redirect(new URL("/?auth_error=session_expired", request.url));
}

export async function GET(request: Request) {
  const nextPath = safeNext(new URL(request.url).searchParams.get("next"));
  const session = await readSession();
  if (!session) return NextResponse.redirect(new URL("/?auth_error=session", request.url));
  const step = nextAuthStep(session);
  if (step === "ok") return NextResponse.redirect(new URL(nextPath, request.url));
  if (step === "reconnect" || !session.refreshToken) {
    await clearSession();
    return reconnect(request);
  }
  const config = getConfig();
  try {
    const tokens = await refreshAccessToken({
      refreshToken: session.refreshToken,
      clientId: config.clientId,
      clientSecret: config.clientSecret || undefined,
    });
    await writeSession(tokens);
    return NextResponse.redirect(new URL(nextPath, request.url));
  } catch {
    await clearSession();
    return reconnect(request);
  }
}
