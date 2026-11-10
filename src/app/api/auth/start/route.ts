import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/auth/oauth";
import { codeChallenge, generateCodeVerifier, randomState } from "@/auth/pkce";
import { writeOauthHandoff } from "@/auth/session";
import { getConfig, oauthConfigured, redirectUriFor } from "@/config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = getConfig();
  if (!oauthConfigured(config)) {
    return NextResponse.redirect(new URL("/?auth_error=not_configured", request.url));
  }
  const state = randomState();
  const verifier = generateCodeVerifier();
  await writeOauthHandoff({ state, verifier });
  const url = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri: redirectUriFor(request, config),
    state,
    codeChallenge: codeChallenge(verifier),
  });
  return NextResponse.redirect(url);
}
