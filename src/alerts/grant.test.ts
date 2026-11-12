import { describe, expect, it } from "vitest";
import { BufferAuthError } from "@/buffer/client";
import type { TokenSet } from "@/auth/oauth";
import { getAccessToken, type GrantStore } from "./grant";
import type { Release } from "./types";

const NOW = new Date("2026-11-13T07:00:00.000Z");

/** Models Buffer: every refresh spends the token, and replaying a spent one revokes the whole grant. */
function buffer(initial: string) {
  const state = { current: initial, spent: new Set<string>(), revoked: false, refreshes: 0, counter: 0 };
  const refresh = async (token: string): Promise<TokenSet> => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    state.refreshes += 1;
    if (state.revoked || state.spent.has(token) || token !== state.current) {
      state.revoked = true;
      throw new Error("invalid_grant");
    }
    state.spent.add(token);
    state.counter += 1;
    state.current = `RT${state.counter}`;
    return { accessToken: `AT${state.counter}`, refreshToken: state.current, expiresAt: NOW.getTime() + 3_600_000, scope: "posts:read" };
  };
  return { state, refresh };
}

function memoryGrants(initial: { refreshToken: string | null; accessToken: string | null; expiresAt: number }) {
  const store = {
    grant: { ...initial },
    writes: 0,
    locks: new Set<string>(),
    failWrites: false,
    async readGrant() {
      return { ...store.grant };
    },
    async writeGrant(_id: string, grant: { refreshToken: string; accessToken: string; expiresAt: number }) {
      if (store.failWrites) throw new Error("down");
      store.writes += 1;
      store.grant = { ...grant };
    },
    async acquireLock(name: string): Promise<Release | null> {
      if (store.locks.has(name)) return null;
      store.locks.add(name);
      return async () => {
        store.locks.delete(name);
      };
    },
  };
  return store satisfies GrantStore & Record<string, unknown>;
}

const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 2));
const expired = { refreshToken: "RT0", accessToken: "AT0", expiresAt: NOW.getTime() - 1000 };

describe("alert grant: single-flight refresh of a rotating token", () => {
  it("uses the saved access token while it is still valid, without calling Buffer", async () => {
    const b = buffer("RT0");
    const grants = memoryGrants({ ...expired, expiresAt: NOW.getTime() + 600_000 });
    expect(await getAccessToken({ grants, refresh: b.refresh, now: () => NOW, sleep }, "owner")).toBe("AT0");
    expect(b.state.refreshes).toBe(0);
  });

  it("two callers at once refresh exactly once, and neither revokes the grant", async () => {
    const b = buffer("RT0");
    const grants = memoryGrants(expired);
    const deps = { grants, refresh: b.refresh, now: () => NOW, sleep };
    const results = await Promise.all([getAccessToken(deps, "owner"), getAccessToken(deps, "owner"), getAccessToken(deps, "owner")]);
    expect(b.state.refreshes).toBe(1);
    expect(b.state.revoked).toBe(false);
    expect(new Set(results)).toEqual(new Set(["AT1"]));
    expect(grants.grant.refreshToken).toBe("RT1");
  });

  it("saves the replacement refresh token before the access token is returned", async () => {
    const b = buffer("RT0");
    const grants = memoryGrants(expired);
    const order: string[] = [];
    const original = grants.writeGrant.bind(grants);
    grants.writeGrant = async (...args) => {
      order.push("saved");
      return original(...args);
    };
    await getAccessToken({ grants, refresh: b.refresh, now: () => NOW, sleep }, "owner");
    order.push("returned");
    expect(order).toEqual(["saved", "returned"]);
  });

  it("never retries a rejected refresh token, and says to turn alerts on again", async () => {
    const b = buffer("RT0");
    b.state.revoked = true;
    const grants = memoryGrants(expired);
    const error = await getAccessToken({ grants, refresh: b.refresh, now: () => NOW, sleep }, "owner").catch((e) => e);
    expect(error).toBeInstanceOf(BufferAuthError);
    expect(error.message).toContain("/alerts/setup");
    expect(error.message).not.toContain("RT0");
    expect(b.state.refreshes).toBe(1);
  });

  it("fails clearly when the new token cannot be saved (the old one is spent)", async () => {
    const b = buffer("RT0");
    const grants = memoryGrants(expired);
    grants.failWrites = true;
    await expect(getAccessToken({ grants, refresh: b.refresh, now: () => NOW, sleep }, "owner")).rejects.toThrow(/could not be saved/);
  });

  it("is a reconnect error when alerts were turned off (no refresh token)", async () => {
    const grants = memoryGrants({ refreshToken: null, accessToken: null, expiresAt: 0 });
    await expect(getAccessToken({ grants, refresh: buffer("x").refresh, now: () => NOW, sleep }, "owner")).rejects.toBeInstanceOf(BufferAuthError);
  });

  it("releases the refresh lock after a failure", async () => {
    const b = buffer("RT0");
    b.state.revoked = true;
    const grants = memoryGrants(expired);
    await getAccessToken({ grants, refresh: b.refresh, now: () => NOW, sleep }, "owner").catch(() => undefined);
    expect(grants.locks.size).toBe(0);
  });
});
