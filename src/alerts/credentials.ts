import { refreshAccessToken, type TokenSet } from "@/auth/oauth";
import { hashSeed, type WatchGrant, type WatchTokenStore } from "./token-store";

export class WatchCredentialError extends Error {
  constructor(
    readonly reason: "not_configured" | "reconnect" | "store_failed",
    message: string,
  ) {
    super(message);
    this.name = "WatchCredentialError";
  }
}

export type WatchCredentialInput = {
  /** BUFFER_REFRESH_TOKEN. Seeds the chain; later runs use the store. */
  seed: string | null;
  store: WatchTokenStore | null;
  clientId: string;
  clientSecret?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

/**
 * Gets an access token for the background run.
 *
 * With a store: the newest refresh token is read from it (or the env seed, the
 * first time or when the env value changed), exchanged, and the replacement is
 * saved BEFORE the access token is used. Without a store the env token is
 * exchanged and the replacement is lost, so this works for one run only.
 * A failed refresh is never retried with the same token: a replay would revoke
 * the whole grant.
 */
export async function getWatchAccessToken(input: WatchCredentialInput): Promise<TokenSet> {
  const seed = input.seed?.trim() || null;
  if (!input.clientId) throw new WatchCredentialError("not_configured", "BUFFER_CLIENT_ID is not set.");

  let refreshToken: string | null = null;
  let seedHash = seed ? hashSeed(seed) : "";
  if (input.store) {
    let stored: WatchGrant | null;
    try {
      stored = await input.store.read();
    } catch {
      throw new WatchCredentialError("store_failed", "The token store could not be read, so nothing was refreshed.");
    }
    if (stored && (!seed || stored.seedHash === seedHash)) {
      refreshToken = stored.refreshToken;
      seedHash = stored.seedHash;
    }
  }
  if (!refreshToken) refreshToken = seed;
  if (!refreshToken) {
    throw new WatchCredentialError("not_configured", "BUFFER_REFRESH_TOKEN is not set and the token store is empty.");
  }

  let tokens: TokenSet;
  try {
    tokens = await refreshAccessToken({
      refreshToken,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      fetchImpl: input.fetchImpl,
    });
  } catch {
    throw new WatchCredentialError(
      "reconnect",
      "Buffer did not accept the saved refresh token (used up or revoked). Run the one-time setup at /alerts/setup again and set a new BUFFER_REFRESH_TOKEN.",
    );
  }

  if (input.store && tokens.refreshToken) {
    try {
      await input.store.write({
        refreshToken: tokens.refreshToken,
        seedHash,
        updatedAt: (input.now?.() ?? new Date()).toISOString(),
      });
    } catch {
      throw new WatchCredentialError(
        "store_failed",
        "Buffer issued a new refresh token but it could not be saved. The old one is now spent: run /alerts/setup again.",
      );
    }
  }
  return tokens;
}
