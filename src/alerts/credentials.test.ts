import { describe, expect, it, vi } from "vitest";
import { open, seal } from "@/auth/seal";
import { getWatchAccessToken, WatchCredentialError } from "./credentials";
import { hashSeed, storeFromEnv, UpstashTokenStore, type WatchGrant, type WatchTokenStore } from "./token-store";

function memoryStore(initial: WatchGrant | null = null): WatchTokenStore & { value: WatchGrant | null; writes: number } {
  const store = {
    name: "memory",
    value: initial,
    writes: 0,
    async read() {
      return store.value;
    },
    async write(grant: WatchGrant) {
      store.writes += 1;
      store.value = grant;
    },
  };
  return store;
}

function tokenResponse(refresh: string) {
  return new Response(JSON.stringify({ access_token: "AT", refresh_token: refresh, expires_in: 3600, scope: "posts:read" }), { status: 200 });
}

function sentRefreshToken(fetchImpl: ReturnType<typeof vi.fn>, call = 0): string {
  const init = fetchImpl.mock.calls[call][1] as RequestInit;
  return new URLSearchParams(String(init.body)).get("refresh_token") ?? "";
}

const base = { clientId: "client", clientSecret: "secret" };

describe("watch credentials (Buffer rotates refresh tokens)", () => {
  it("seeds from the env token, then keeps using the rotated token from the store", async () => {
    const store = memoryStore();
    const fetchImpl = vi.fn(async () => tokenResponse("R1"));
    await getWatchAccessToken({ ...base, seed: "R0", store, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(sentRefreshToken(fetchImpl, 0)).toBe("R0");
    expect(store.value?.refreshToken).toBe("R1");

    fetchImpl.mockImplementation(async () => tokenResponse("R2"));
    await getWatchAccessToken({ ...base, seed: "R0", store, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(sentRefreshToken(fetchImpl, 1)).toBe("R1");
    expect(store.value?.refreshToken).toBe("R2");
  });

  it("starts a new chain when the env token is replaced", async () => {
    const store = memoryStore({ refreshToken: "OLD", seedHash: hashSeed("R0"), updatedAt: "2026-11-10T00:00:00.000Z" });
    const fetchImpl = vi.fn(async () => tokenResponse("N1"));
    await getWatchAccessToken({ ...base, seed: "FRESH", store, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(sentRefreshToken(fetchImpl)).toBe("FRESH");
    expect(store.value).toMatchObject({ refreshToken: "N1", seedHash: hashSeed("FRESH") });
  });

  it("saves the replacement token before the caller gets the access token", async () => {
    const order: string[] = [];
    const store: WatchTokenStore = {
      name: "order",
      read: async () => null,
      write: async () => {
        order.push("write");
      },
    };
    const fetchImpl = vi.fn(async () => tokenResponse("R1"));
    await getWatchAccessToken({ ...base, seed: "R0", store, fetchImpl: fetchImpl as unknown as typeof fetch });
    order.push("returned");
    expect(order).toEqual(["write", "returned"]);
  });

  it("never retries a failed refresh with the same token", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    await expect(getWatchAccessToken({ ...base, seed: "R0", store: memoryStore(), fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({
      reason: "reconnect",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not put any token in its error messages", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "bad R0-secret-token" }), { status: 400 }));
    const error = await getWatchAccessToken({ ...base, seed: "R0-secret-token", store: null, fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(error).toBeInstanceOf(WatchCredentialError);
    expect(String(error.message)).not.toContain("R0-secret-token");
  });

  it("reports store_failed when the new token cannot be saved", async () => {
    const store: WatchTokenStore = { name: "bad", read: async () => null, write: async () => { throw new Error("down"); } };
    await expect(
      getWatchAccessToken({ ...base, seed: "R0", store, fetchImpl: (async () => tokenResponse("R1")) as unknown as typeof fetch }),
    ).rejects.toMatchObject({ reason: "store_failed" });
  });

  it("is not configured with no env token and an empty store", async () => {
    await expect(getWatchAccessToken({ ...base, seed: null, store: memoryStore() })).rejects.toMatchObject({ reason: "not_configured" });
    await expect(getWatchAccessToken({ ...base, seed: "R0", store: null, clientId: "" })).rejects.toMatchObject({ reason: "not_configured" });
  });
});

describe("Upstash token store", () => {
  it("encrypts the grant before writing it and reads it back", async () => {
    let saved = "";
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const args = JSON.parse(String(init?.body)) as string[];
      if (args[0] === "SET") {
        saved = args[2];
        return new Response(JSON.stringify({ result: "OK" }));
      }
      return new Response(JSON.stringify({ result: saved || null }));
    });
    const store = new UpstashTokenStore("https://redis.test", "tok", "session-secret-xxxxxxxxxxxxxxxxxxxx", fetchImpl as unknown as typeof fetch);
    const grant = { refreshToken: "plain-refresh-token", seedHash: "abc", updatedAt: "2026-11-10T00:00:00.000Z" };
    await store.write(grant);
    expect(saved).not.toContain("plain-refresh-token");
    expect(open(saved, "session-secret-xxxxxxxxxxxxxxxxxxxx")).toEqual(grant);
    expect(await store.read()).toEqual(grant);
    expect(open(seal(grant, "a"), "b")).toBeNull();
  });

  it("is only configured when URL, token and SESSION_SECRET are all present", () => {
    expect(storeFromEnv({})).toBeNull();
    expect(storeFromEnv({ KV_REST_API_URL: "https://r", KV_REST_API_TOKEN: "t" })).toBeNull();
    expect(storeFromEnv({ KV_REST_API_URL: "https://r", KV_REST_API_TOKEN: "t", SESSION_SECRET: "s" })?.name).toBe("upstash");
    expect(storeFromEnv({ UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t", SESSION_SECRET: "s" })?.name).toBe("upstash");
  });
});
