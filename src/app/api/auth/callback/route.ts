import { NextResponse } from "next/server";
import { exchangeAuthorizationCode } from "@/auth/oauth";
import { clearOauthHandoff, readOauthHandoff, writeSession, writeWatchGrant } from "@/auth/session";
import { getConfig, redirectUriFor } from "@/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const handoff = await readOauthHandoff();
  await clearOauthHandoff();

  if (error) {
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(error)}`, request.url));
  }
  if (!handoff || !state || state !== handoff.state) {
    return NextResponse.redirect(new URL("/?auth_error=state_mismatch", request.url));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?auth_error=missing_code", request.url));
  }

  const config = getConfig();
  try {
    const tokens = await exchangeAuthorizationCode({
      code,
      codeVerifier: handoff.verifier,
      clientId: config.clientId,
      clientSecret: config.clientSecret || undefined,
      redirectUri: redirectUriFor(request, config),
    });
    if (handoff.watch) {
      await writeWatchGrant(tokens);
      return NextResponse.redirect(new URL("/alerts/setup", request.url));
    }
    await writeSession(tokens);
    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (exchangeError) {
    const message = exchangeError instanceof Error ? exchangeError.message : "token_exchange_failed";
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(message)}`, request.url));
  }
}
