import { BufferAuthError } from "@/buffer/client";
import type { TokenSet } from "@/auth/oauth";
import type { Release } from "./types";

/** Where the alert grant lives. The Redis store implements it. */
export interface GrantStore {
  readGrant(subscriberId: string): Promise<{ refreshToken: string | null; accessToken: string | null; expiresAt: number } | null>;
  /** Replaces the whole grant. Called before the new access token is used. */
  writeGrant(subscriberId: string, grant: { refreshToken: string; accessToken: string; expiresAt: number }): Promise<void>;
  acquireLock(name: string, ttlMs: number): Promise<Release | null>;
}

export type GrantDeps = {
  grants: GrantStore;
  refresh: (refreshToken: string) => Promise<TokenSet>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

const SKEW_MS = 60_000;
const SAVE_ATTEMPTS = 3;
const SAVE_RETRY_MS = 250;
const WAIT_STEP_MS = 400;
const WAIT_STEPS = 12;

/**
 * An access token for the background run.
 *
 * Buffer refresh tokens are single use: a second refresh with the same token revokes the grant. So
 * refreshing is single-flight. One lock per subscriber, the grant is read again once the lock is held
 * (another caller may just have refreshed), and the replacement refresh token is saved BEFORE the access
 * token is handed out. A failed refresh is never retried with the same token.
 */
export async function getAccessToken(deps: GrantDeps, subscriberId: string): Promise<string> {
  const fresh = async () => {
    const grant = await deps.grants.readGrant(subscriberId);
    if (!grant?.refreshToken) throw new BufferAuthError("Alerts are not connected to Buffer. Turn them on again at /alerts/setup.");
    return grant;
  };
  const valid = (grant: { accessToken: string | null; expiresAt: number }) =>
    Boolean(grant.accessToken) && grant.expiresAt > deps.now().getTime() + SKEW_MS;

  let grant = await fresh();
  if (valid(grant)) return grant.accessToken!;

  let release: Release | null = null;
  for (let step = 0; step <= WAIT_STEPS && !release; step += 1) {
    release = await deps.grants.acquireLock(`refresh:${subscriberId}`, 30_000);
    if (release) break;
    await deps.sleep(WAIT_STEP_MS);
    grant = await fresh();
    if (valid(grant)) return grant.accessToken!; // the other caller finished
  }
  if (!release) throw new Error("Another refresh is still running. Try again shortly.");

  try {
    grant = await fresh();
    if (valid(grant)) return grant.accessToken!;
    let tokens: TokenSet;
    try {
      tokens = await deps.refresh(grant.refreshToken!);
    } catch {
      throw new BufferAuthError("Buffer did not accept the saved alert token. Turn alerts on again at /alerts/setup.");
    }
    if (!tokens.refreshToken) throw new BufferAuthError("Buffer did not return a refresh token. Turn alerts on again at /alerts/setup.");
    // The old refresh token is spent now, so losing the new one ends the grant. Retry a transient store failure.
    let saved = false;
    for (let attempt = 1; attempt <= SAVE_ATTEMPTS && !saved; attempt += 1) {
      try {
        await deps.grants.writeGrant(subscriberId, { refreshToken: tokens.refreshToken, accessToken: tokens.accessToken, expiresAt: tokens.expiresAt });
        saved = true;
      } catch {
        if (attempt < SAVE_ATTEMPTS) await deps.sleep(SAVE_RETRY_MS * attempt);
      }
    }
    if (!saved) throw new Error("Buffer issued a new alert token but it could not be saved, and the old one is spent. Turn alerts on again at /alerts/setup.");
    return tokens.accessToken;
  } finally {
    await release();
  }
}
