import { NextResponse } from "next/server";
import { exchangeAuthorizationCode } from "@/auth/oauth";
import { storeFromEnv } from "@/alerts/deps";
import { decideOwner, fetchAccountId, type OwnerRecord } from "@/alerts/owner";
import { UnreadableGrantError } from "@/alerts/crypto";
import { safeNext } from "@/auth/next-path";
import { clearAlertSetup, clearOauthHandoff, readAlertSetupArm, readOauthHandoff, writeSession } from "@/auth/session";
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
      const arm = await readAlertSetupArm();
      await clearAlertSetup();
      if (!arm) return NextResponse.redirect(new URL("/alerts/setup?problem=arm", request.url));
      if (!tokens.refreshToken) return NextResponse.redirect(new URL("/alerts/setup?problem=refresh", request.url));
      try {
        // The grant must belong to the owner account that armed this: a different Buffer login in the sign-in step
        // would otherwise put someone else's queue behind the owner's switch. Ownership is decided again here.
        const grantAccountId = await fetchAccountId(tokens.accessToken);
        if (!grantAccountId || grantAccountId !== arm.accountId) return NextResponse.redirect(new URL("/alerts/setup?problem=owner", request.url));
        const { store } = storeFromEnv();
        let record: OwnerRecord;
        try {
          record = await store.readSubscriber();
        } catch (readError) {
          if (!(readError instanceof UnreadableGrantError)) throw readError;
          record = "unreadable";
        }
        if (!decideOwner(grantAccountId, record, process.env).owner) return NextResponse.redirect(new URL("/alerts/setup?problem=owner", request.url));
        await store.enable({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt }, new Date(), grantAccountId);
      } catch {
        return NextResponse.redirect(new URL("/alerts/setup?problem=check", request.url));
      }
      return NextResponse.redirect(new URL("/alerts/setup?on=1", request.url));
    }
    await writeSession(tokens);
    return NextResponse.redirect(new URL(handoff.next ? safeNext(handoff.next) : "/dashboard", request.url));
  } catch (exchangeError) {
    const message = exchangeError instanceof Error ? exchangeError.message : "token_exchange_failed";
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(message)}`, request.url));
  }
}
