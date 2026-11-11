import { describe, expect, it } from "vitest";
import { nextAuthStep } from "./flow";
import { buildAuthorizeUrl, readTokenSet, tokenRequestBody } from "./oauth";
import { codeChallenge } from "./pkce";
import { chunk, open, seal } from "./seal";

describe("PKCE", () => {
  it("matches the RFC 7636 S256 test vector", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(codeChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});

describe("authorize URL", () => {
  it("asks Buffer for the read scopes, PKCE S256, and a state", () => {
    const url = new URL(buildAuthorizeUrl({
      clientId: "client",
      redirectUri: "http://localhost:3000/api/auth/callback",
      state: "state",
      codeChallenge: "challenge",
    }));
    expect(url.origin + url.pathname).toBe("https://auth.buffer.com/auth");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("account:read posts:read offline_access");
    expect(url.searchParams.get("state")).toBe("state");
  });

  it("omits an empty client secret and keeps a rotated refresh token", () => {
    const body = tokenRequestBody({ client_id: "client", client_secret: undefined, grant_type: "refresh_token" });
    expect(body.has("client_secret")).toBe(false);
    expect(body.get("grant_type")).toBe("refresh_token");

    const tokens = readTokenSet(
      { access_token: "new-access", expires_in: 3600, scope: "posts:read" },
      1_000,
      "old-refresh",
    );
    expect(tokens.refreshToken).toBe("old-refresh");
    expect(tokens.expiresAt).toBe(1_000 + 3_600_000);

    const rotated = readTokenSet({ access_token: "a", refresh_token: "rotated", expires_in: 3600 }, 0, "old");
    expect(rotated.refreshToken).toBe("rotated");
  });

  it("keeps a session when Buffer returns no refresh token", () => {
    const tokens = readTokenSet({ access_token: "access-only", expires_in: 3600, scope: "account:read posts:read" }, 5_000);
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.expiresAt).toBe(5_000 + 3_600_000);
  });
});

describe("expired access token", () => {
  it("asks for a reconnect instead of throwing when there is nothing to refresh", () => {
    const now = 1_700_000_000_000;
    expect(nextAuthStep({ refreshToken: null, expiresAt: now - 1_000 }, now)).toBe("reconnect");
    expect(nextAuthStep({ refreshToken: "refresh", expiresAt: now - 1_000 }, now)).toBe("refresh");
    expect(nextAuthStep({ refreshToken: null, expiresAt: now + 3_600_000 }, now)).toBe("ok");
  });
});

describe("sealed cookies", () => {
  it("round-trips a payload and rejects tampering", () => {
    const secret = "test-secret-that-is-long-enough";
    const sealed = seal({ refreshToken: "v1.secret" }, secret);
    expect(open(sealed, secret)).toEqual({ refreshToken: "v1.secret" });
    expect(open(sealed, "other-secret")).toBeNull();
    expect(open(`${sealed}x`, secret)).toBeNull();
  });

  it("splits a large token into cookie-sized chunks that join back", () => {
    const secret = "test-secret-that-is-long-enough";
    const payload = { accessToken: "a".repeat(5000), refreshToken: "b".repeat(2000), expiresAt: 10 };
    const parts = chunk(seal(payload, secret), 3000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 3000)).toBe(true);
    expect(open(parts.join(""), secret)).toEqual(payload);
  });
});
