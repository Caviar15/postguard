export const DEFAULT_SCOPE = "account:read posts:read offline_access";

export function buildAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const url = new URL("https://auth.buffer.com/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scope ?? DEFAULT_SCOPE);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "consent");
  return url.toString();
}

export type TokenSet = {
  accessToken: string;
  /** Null when Buffer does not grant offline_access. The access token still works until expiresAt. */
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
};

type TokenJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export function tokenRequestBody(fields: Record<string, string | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value) body.set(key, value);
  }
  return body;
}

export function readTokenSet(payload: unknown, now = Date.now(), previousRefreshToken?: string): TokenSet {
  const body = (payload ?? {}) as TokenJson;
  if (!body.access_token || typeof body.expires_in !== "number") {
    const description = body.error_description || body.error || "Token response was missing access_token.";
    throw new Error(description);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || previousRefreshToken || null,
    expiresAt: now + body.expires_in * 1000,
    scope: body.scope ?? DEFAULT_SCOPE,
  };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenSet> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://auth.buffer.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: tokenRequestBody({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
  });
  const json = (await response.json().catch(() => ({}))) as TokenJson;
  if (!response.ok) {
    throw new Error(json.error_description || json.error || `Token exchange failed with HTTP ${response.status}.`);
  }
  return readTokenSet(json);
}

export async function refreshAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenSet> {
  if (!input.refreshToken) {
    throw new Error("No refresh token.");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl("https://auth.buffer.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: tokenRequestBody({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as TokenJson;
  if (!response.ok) {
    throw new Error(json.error_description || json.error || `Refresh failed with HTTP ${response.status}.`);
  }
  return readTokenSet(json, Date.now(), input.refreshToken);
}
