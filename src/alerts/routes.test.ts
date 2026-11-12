import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

const CRON = "cron-secret-for-route-tests-1234";
process.env.SESSION_SECRET = "alerts-route-test-secret-xxxxxxxxxxxxxxxx";
process.env.BUFFER_CLIENT_ID = "client";

import { GET as cronGET } from "@/app/api/cron/alerts/route";
import { GET as startGET } from "@/app/api/auth/start/route";
import { GET as callbackGET } from "@/app/api/auth/callback/route";
import { GET as unsubGET, POST as unsubPOST } from "@/app/api/alerts/unsubscribe/route";
import { POST as enablePOST } from "@/app/api/alerts/enable/route";
import { POST as disablePOST } from "@/app/api/alerts/disable/route";
import { isAlertSetupArmed, readOauthHandoff } from "@/auth/session";
import { FakeRedis } from "./fake-redis";
import { storeFromEnv } from "./deps";

const ORIGIN = "https://postguard.test";
let redis: FakeRedis;
let fetchSpy: { mockRestore: () => void };

function form(values: Record<string, string>): RequestInit {
  return { method: "POST", body: new URLSearchParams(values), headers: { "content-type": "application/x-www-form-urlencoded" } };
}

beforeEach(() => {
  jar.clear();
  redis = new FakeRedis();
  process.env.CRON_SECRET = CRON;
  process.env.KV_REST_API_URL = "https://redis.test";
  process.env.KV_REST_API_TOKEN = "redis-token";
  process.env.ALERT_EMAIL_TO = "owner@example.test";
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://redis.test") return new Response(JSON.stringify({ result: await redis.command(JSON.parse(String(init?.body))) }));
    if (url === "https://auth.buffer.com/token") {
      return new Response(JSON.stringify({ access_token: "AT-route-secret", refresh_token: "RT-route-secret", expires_in: 3600 }));
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch);
});

afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/alerts", () => {
  it("is closed without the secret (401) and without any run", async () => {
    expect((await cronGET(new Request(`${ORIGIN}/api/cron/alerts`))).status).toBe(401);
    expect((await cronGET(new Request(`${ORIGIN}/api/cron/alerts`, { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(redis.commands).toHaveLength(0);
  });

  it("answers 5xx, never 'Bearer undefined' success, when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    for (const authorization of ["Bearer undefined", "Bearer ", "Bearer null"]) {
      const res = await cronGET(new Request(`${ORIGIN}/api/cron/alerts`, { headers: { authorization } }));
      expect(res.status).toBe(500);
    }
    expect(redis.commands).toHaveLength(0);
  });

  it("runs with the secret, is not cacheable, and with alerts off does nothing", async () => {
    const res = await cronGET(new Request(`${ORIGIN}/api/cron/alerts`, { headers: { authorization: `Bearer ${CRON}` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toMatchObject({ status: "ok", sent: 0 });
  });

  it("with no Redis alerts are simply not set up: 200, nothing runs, no secret echoed", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    const res = await cronGET(new Request(`${ORIGIN}/api/cron/alerts`, { headers: { authorization: `Bearer ${CRON}` } }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(CRON);
    expect(JSON.parse(text)).toMatchObject({ status: "ok", sent: 0 });
  });
});

describe("turning alerts on needs the setup code", () => {
  it("a wrong or empty code does not arm the sign-in", async () => {
    for (const code of ["", "wrong-code-wrong-code-wrong", CRON.slice(0, 20), `${CRON}x`]) {
      const res = await enablePOST(new Request(`${ORIGIN}/api/alerts/enable`, form({ code })));
      expect(new URL(res.headers.get("location")!).search).toContain("problem=code");
    }
    expect(await isAlertSetupArmed()).toBe(false);
  });

  it("with no CRON_SECRET configured no code works, not even an empty one", async () => {
    delete process.env.CRON_SECRET;
    const res = await enablePOST(new Request(`${ORIGIN}/api/alerts/enable`, form({ code: "undefined" })));
    expect(new URL(res.headers.get("location")!).search).toContain("problem=code");
    expect(await isAlertSetupArmed()).toBe(false);
  });

  it("the right code arms it and continues to the Buffer sign-in in alert mode", async () => {
    const res = await enablePOST(new Request(`${ORIGIN}/api/alerts/enable`, form({ code: CRON })));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/api/auth/start");
    expect(await isAlertSetupArmed()).toBe(true);
    await startGET(new Request(`${ORIGIN}/api/auth/start?watch=1`));
    expect((await readOauthHandoff())?.watch).toBe(true);
  });

  it("an unarmed browser cannot start the alert sign-in", async () => {
    const res = await startGET(new Request(`${ORIGIN}/api/auth/start?watch=1`));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/alerts/setup");
    expect(await readOauthHandoff()).toBeNull();
  });

  async function reachCallback(armed: boolean) {
    if (armed) await enablePOST(new Request(`${ORIGIN}/api/alerts/enable`, form({ code: CRON })));
    // Not armed: write the handoff directly, as if someone crafted the start step.
    const { writeOauthHandoff } = await import("@/auth/session");
    await writeOauthHandoff({ state: "st", verifier: "v", watch: true });
    return callbackGET(new Request(`${ORIGIN}/api/auth/callback?code=abc&state=st`));
  }

  it("the alert callback stores the grant encrypted on the server and creates NO browser session", async () => {
    const res = await reachCallback(true);
    expect(new URL(res.headers.get("location")!).search).toContain("on=1");
    expect(jar.has("pg_sess_0")).toBe(false);
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(true);
    const stored = JSON.stringify([...redis.data.values()]);
    expect(stored).not.toContain("RT-route-secret");
    expect(stored).not.toContain("AT-route-secret");
    expect(await isAlertSetupArmed()).toBe(false); // single use
  });

  it("without the arm cookie the callback stores nothing", async () => {
    const res = await reachCallback(false);
    expect(new URL(res.headers.get("location")!).search).toContain("problem=code");
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(false);
    expect(redis.data.size).toBe(0);
  });

  it("turning alerts off needs the code too, then deletes the token", async () => {
    await reachCallback(true);
    const denied = await disablePOST(new Request(`${ORIGIN}/api/alerts/disable`, form({ code: "nope-nope-nope-nope-nope" })));
    expect(new URL(denied.headers.get("location")!).search).toContain("problem=code");
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(true);
    const done = await disablePOST(new Request(`${ORIGIN}/api/alerts/disable`, form({ code: CRON })));
    expect(new URL(done.headers.get("location")!).search).toContain("off=1");
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(false);
    expect((await storeFromEnv(process.env).store.readSubscriber())?.refreshToken).toBeNull();
  });
});

describe("/api/alerts/unsubscribe", () => {
  async function enabled() {
    await reachCallbackArmed();
    const [owner] = await storeFromEnv(process.env).store.listSubscribers();
    return owner!.unsubscribeToken;
  }
  async function reachCallbackArmed() {
    await enablePOST(new Request(`${ORIGIN}/api/alerts/enable`, form({ code: CRON })));
    const { writeOauthHandoff } = await import("@/auth/session");
    await writeOauthHandoff({ state: "st", verifier: "v", watch: true });
    await callbackGET(new Request(`${ORIGIN}/api/auth/callback?code=abc&state=st`));
  }

  it("GET only shows a confirmation with a POST form and changes nothing", async () => {
    const token = await enabled();
    const res = await unsubGET(new Request(`${ORIGIN}/api/alerts/unsubscribe?token=${token}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/<form method="post"/);
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(true);
  });

  it("the one-click POST unsubscribes and deletes the stored Buffer token", async () => {
    const token = await enabled();
    const res = await unsubPOST(new Request(`${ORIGIN}/api/alerts/unsubscribe?token=${token}`, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(res.status).toBe(200);
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(false);
    expect((await storeFromEnv(process.env).store.readSubscriber())?.refreshToken).toBeNull();
  });

  it("a bogus token is refused", async () => {
    await enabled();
    const res = await unsubPOST(new Request(`${ORIGIN}/api/alerts/unsubscribe?token=bogus-token-bogus-token-bogus`, { method: "POST" }));
    expect(res.status).toBe(404);
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(true);
  });
});

describe("product honesty", () => {
  it("the privacy page says alerts store an encrypted refresh token on the server, and how to delete it", () => {
    const privacy = fs.readFileSync(path.join(__dirname, "../app/privacy/page.tsx"), "utf8");
    expect(privacy).toMatch(/refresh token on the server/);
    expect(privacy).toMatch(/encrypted with AES-256-GCM/);
    expect(privacy).toMatch(/deletes the stored token/);
    expect(privacy).toMatch(/Nothing about the dashboard sign-in is stored on the server/);
  });
});
