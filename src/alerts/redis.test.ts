import { describe, expect, it } from "vitest";
import { open } from "@/auth/seal";
import { FakeRedis } from "./fake-redis";
import { OWNER_ID, RedisAlertStore, UpstashRedis, redisFromEnv } from "./redis";

const SECRET = "redis-test-session-secret-xxxxxxxxxxxxxxxx";
const tokens = { accessToken: "AT-plain-secret", refreshToken: "RT-plain-secret", expiresAt: 1_900_000_000_000 };

function make(clock = () => 1_000_000) {
  const redis = new FakeRedis(clock);
  const store = new RedisAlertStore(redis, SECRET, () => ({ email: "owner@example.test", timeZone: "Europe/Amsterdam" }));
  return { redis, store };
}

describe("alert store on Redis", () => {
  it("claims a key once, atomically, under concurrent callers", async () => {
    const { store } = make();
    const results = await Promise.all(Array.from({ length: 8 }, () => store.claim("owner|p1|f1", 60_000)));
    expect(results.filter(Boolean)).toHaveLength(1);
    await store.unclaim("owner|p1|f1");
    expect(await store.claim("owner|p1|f1", 60_000)).toBe(true);
  });

  it("claims expire after their TTL", async () => {
    let now = 1000;
    const { store } = make(() => now);
    expect(await store.claim("k", 500)).toBe(true);
    now += 400;
    expect(await store.claim("k", 500)).toBe(false);
    now += 200;
    expect(await store.claim("k", 500)).toBe(true);
  });

  it("only one run holds the lock, and a late release cannot free someone else's lock", async () => {
    let now = 1000;
    const { store } = make(() => now);
    const first = await store.acquireLock("alerts-run", 1000);
    expect(first).not.toBeNull();
    expect(await store.acquireLock("alerts-run", 1000)).toBeNull();
    now += 2000; // the first holder is too slow and its lock expires
    const second = await store.acquireLock("alerts-run", 1000);
    expect(second).not.toBeNull();
    await first!(); // must NOT release the second holder's lock
    expect(await store.acquireLock("alerts-run", 1000)).toBeNull();
    await second!();
    expect(await store.acquireLock("alerts-run", 1000)).not.toBeNull();
  });

  it("stores the subscriber encrypted: no token in clear text anywhere in Redis", async () => {
    const { redis, store } = make();
    await store.enable(tokens);
    const raw = JSON.stringify([...redis.data.entries()]);
    expect(raw).not.toContain("AT-plain-secret");
    expect(raw).not.toContain("RT-plain-secret");
    const sealed = [...redis.data.values()][0]!.value;
    expect(open(sealed, SECRET)).toMatchObject({ id: OWNER_ID, refreshToken: "RT-plain-secret" });
    expect(open(sealed, "another-secret")).toBeNull();
  });

  it("lists the owner with the email and zone from settings, and an unguessable unsubscribe token", async () => {
    const { store } = make();
    expect(await store.listSubscribers()).toEqual([]);
    await store.enable(tokens);
    const [owner] = await store.listSubscribers();
    expect(owner).toMatchObject({ id: OWNER_ID, email: "owner@example.test", timeZone: "Europe/Amsterdam", unsubscribed: false });
    expect(owner!.unsubscribeToken.length).toBeGreaterThanOrEqual(40);
    expect(owner!.unsubscribeToken).not.toContain("RT-plain");
  });

  it("unsubscribe with the right token deletes the stored Buffer token; a wrong token changes nothing", async () => {
    const { store } = make();
    await store.enable(tokens);
    const [owner] = await store.listSubscribers();
    expect(await store.unsubscribe("wrong-token-wrong-token-wrong")).toBe(false);
    expect(await store.isEnabled()).toBe(true);
    expect(await store.unsubscribe(owner!.unsubscribeToken)).toBe(true);
    expect(await store.isEnabled()).toBe(false);
    const record = await store.readSubscriber();
    expect(record).toMatchObject({ unsubscribed: true, refreshToken: null, accessToken: null });
    expect(await store.readGrant(OWNER_ID)).toBeNull();
  });

  it("turning alerts off deletes the token, and a refresh that finishes afterwards cannot bring it back", async () => {
    const { store } = make();
    await store.enable(tokens);
    await store.disable();
    await expect(store.writeGrant(OWNER_ID, { refreshToken: "RT2", accessToken: "AT2", expiresAt: 1 })).rejects.toThrow();
    expect((await store.readSubscriber())?.refreshToken).toBeNull();
  });

  it("turning alerts on again after an unsubscribe starts clean", async () => {
    const { store } = make();
    await store.enable(tokens);
    await store.disable();
    await store.enable({ ...tokens, refreshToken: "RT-new" });
    expect(await store.isEnabled()).toBe(true);
    expect((await store.listSubscribers())[0]!.unsubscribed).toBe(false);
  });

  it("refuses to write anything without SESSION_SECRET (an empty key would be a silent hole)", async () => {
    const store = new RedisAlertStore(new FakeRedis(), "", () => ({ email: "", timeZone: null }));
    await expect(store.enable(tokens)).rejects.toThrow(/SESSION_SECRET/);
  });
});

describe("Upstash REST client", () => {
  it("sends the command as a JSON array with the bearer token, and never puts the token in an error", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const ok = new UpstashRedis("https://redis.test", "up-token-123", (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ result: "OK" }));
    }) as unknown as typeof fetch);
    expect(await ok.command(["SET", "k", "v", "NX", "PX", 5])).toBe("OK");
    expect(seen!.url).toBe("https://redis.test");
    expect(JSON.parse(String(seen!.init.body))).toEqual(["SET", "k", "v", "NX", "PX", 5]);
    const failing = new UpstashRedis("https://redis.test", "up-token-123", (async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
    const error = (await failing.command(["GET", "k"]).catch((e) => e)) as Error;
    expect(String(error.message)).not.toContain("up-token-123");
  });

  it("reads KV_REST_API_* or UPSTASH_REDIS_REST_*, and reports when neither is set", async () => {
    expect(redisFromEnv({}).configured).toBe(false);
    await expect(redisFromEnv({}).client.command(["GET", "k"])).rejects.toThrow(/not configured/);
    expect(redisFromEnv({ KV_REST_API_URL: "https://r", KV_REST_API_TOKEN: "t" }).configured).toBe(true);
    expect(redisFromEnv({ UPSTASH_REDIS_REST_URL: "https://r", UPSTASH_REDIS_REST_TOKEN: "t" }).configured).toBe(true);
  });
});
