import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/auth/oauth";
import { codeChallenge, generateCodeVerifier, randomState } from "@/auth/pkce";
import { safeNext } from "@/auth/next-path";
import { isAlertSetupArmed, writeOauthHandoff } from "@/auth/session";
import { getConfig, oauthConfigured, redirectUriFor } from "@/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = getConfig();
  if (!oauthConfigured(config)) {
    return NextResponse.redirect(new URL("/?auth_error=not_configured", request.url));
  }
  const params = new URL(request.url).searchParams;
  const watch = params.get("watch") === "1";
  if (watch && !(await isAlertSetupArmed())) {
    return NextResponse.redirect(new URL("/alerts/setup?problem=arm", request.url));
  }
  // Where a normal sign-in returns to (for example the alerts page). Only an in-app path; none means the dashboard.
  const rawNext = params.get("next");
  const next = !watch && rawNext ? safeNext(rawNext) : undefined;
  const state = randomState();
  const verifier = generateCodeVerifier();
  await writeOauthHandoff({ state, verifier, watch, ...(next ? { next } : {}) });
  const url = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: redirectUriFor(request, config),
    state,
    codeChallenge: codeChallenge(verifier),
  });
  return NextResponse.redirect(url);
}
