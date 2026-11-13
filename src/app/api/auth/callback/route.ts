import { NextResponse } from "next/server";
import { exchangeAuthorizationCode } from "@/auth/oauth";
import { storeFromEnv } from "@/alerts/deps";
import { clearAlertSetup, clearOauthHandoff, isAlertSetupArmed, readOauthHandoff, writeSession } from "@/auth/session";
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
      // A separate Buffer grant for background alerts, saved encrypted on the server. It is not a browser session.
      const armed = await isAlertSetupArmed();
      await clearAlertSetup();
      if (!armed) return NextResponse.redirect(new URL("/alerts/setup?problem=code", request.url));
      if (!tokens.refreshToken) return NextResponse.redirect(new URL("/alerts/setup?problem=refresh", request.url));
      try {
        await storeFromEnv().store.enable({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt });
      } catch {
        return NextResponse.redirect(new URL("/alerts/setup?problem=store", request.url));
      }
      return NextResponse.redirect(new URL("/alerts/setup?on=1", request.url));
    }
    await writeSession(tokens);
    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (exchangeError) {
    const message = exchangeError instanceof Error ? exchangeError.message : "token_exchange_failed";
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(message)}`, request.url));
  }
}
