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
import { isAlertSetupArmed, readOauthHandoff, writeSession } from "@/auth/session";
import { FakeRedis } from "./fake-redis";
import { storeFromEnv } from "./deps";

const ORIGIN = "https://postguard.test";
const OWNER = "acct-owner";
const STRANGER = "acct-stranger";
/** Buffer access token -> the account it belongs to (the mocked `account` query). */
const ACCOUNTS: Record<string, string> = { "AT-session-owner": OWNER, "AT-session-stranger": STRANGER, "AT-route-secret": OWNER };
let redis: FakeRedis;
let fetchSpy: { mockRestore: () => void };

/** A same-origin form POST, as a browser sends it. */
function post(path: string, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });
}

async function signIn(who: "owner" | "stranger" = "owner", expiresInMs = 3_600_000) {
  await writeSession({ accessToken: `AT-session-${who}`, refreshToken: "RT-session", expiresAt: Date.now() + expiresInMs, scope: "" });
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
    if (url === "https://api.buffer.com") {
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      const id = ACCOUNTS[auth.replace(/^Bearer /, "")];
      if (!id) return new Response(JSON.stringify({ errors: [{ message: "unauthorized" }] }), { status: 401 });
      return new Response(JSON.stringify({ data: { account: { id, organizations: [{ id: "o1", name: "Org" }] } } }));
    }
    if (url === "https://auth.buffer.com/token") {
      return new Response(JSON.stringify({ access_token: "AT-route-secret", refresh_token: "RT-route-secret", expires_in: 3600 }));
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch);
});

afterEach(() => {
  fetchSpy.mockRestore();
  delete process.env.CRON_SECRET;
  delete process.env.ALERT_OWNER_BUFFER_ACCOUNT_ID;
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

const locationOf = (res: Response) => new URL(res.headers.get("location")!, ORIGIN);

describe("turning alerts on needs the owner's signed-in session, not a code", () => {
  it("a signed-out visitor is sent to sign in and nothing is armed", async () => {
    const res = await enablePOST(post("/api/alerts/enable"));
    expect(locationOf(res).search).toBe("?problem=signin");
    expect(await isAlertSetupArmed()).toBe(false);
  });

  it("a session Buffer rejects counts as signed out", async () => {
    await writeSession({ accessToken: "AT-revoked", refreshToken: null, expiresAt: Date.now() + 3_600_000, scope: "" });
    expect(locationOf(await enablePOST(post("/api/alerts/enable"))).search).toBe("?problem=signin");
    expect(await isAlertSetupArmed()).toBe(false);
  });

  it("an expired session with no refresh token counts as signed out; one with a refresh token is renewed first", async () => {
    await writeSession({ accessToken: "AT-session-owner", refreshToken: null, expiresAt: Date.now() - 1000, scope: "" });
    expect(locationOf(await enablePOST(post("/api/alerts/enable"))).search).toBe("?problem=signin");
    await writeSession({ accessToken: "AT-session-owner", refreshToken: "RT", expiresAt: Date.now() - 1000, scope: "" });
    const res = locationOf(await enablePOST(post("/api/alerts/enable")));
    expect(res.pathname).toBe("/api/auth/refresh");
    expect(res.searchParams.get("next")).toBe("/alerts/setup");
    expect(await isAlertSetupArmed()).toBe(false);
  });

  it("a signed-in stranger is refused when the owner is configured, and nothing is armed", async () => {
    process.env.ALERT_OWNER_BUFFER_ACCOUNT_ID = OWNER;
    await signIn("stranger");
    const res = await enablePOST(post("/api/alerts/enable"));
    expect(locationOf(res).search).toBe("?problem=owner");
    expect(await isAlertSetupArmed()).toBe(false);
  });

  it("the configured owner arms the sign-in and continues to the Buffer sign-in in alert mode", async () => {
    process.env.ALERT_OWNER_BUFFER_ACCOUNT_ID = OWNER;
    await signIn("owner");
    const res = await enablePOST(post("/api/alerts/enable"));
    expect(locationOf(res).pathname).toBe("/api/auth/start");
    expect(await isAlertSetupArmed()).toBe(true);
    await startGET(new Request(`${ORIGIN}/api/auth/start?watch=1`));
    expect((await readOauthHandoff())?.watch).toBe(true);
  });

  it("with no owner set and no grant, the first signed-in account claims it", async () => {
    await signIn("stranger");
    expect(locationOf(await enablePOST(post("/api/alerts/enable"))).pathname).toBe("/api/auth/start");
  });

  it("a cross-site POST is refused even with the owner's cookies (no Origin, wrong Origin)", async () => {
    process.env.ALERT_OWNER_BUFFER_ACCOUNT_ID = OWNER;
    await signIn("owner");
    for (const headers of [{}, { origin: "https://evil.example" }, { origin: "null" }, { origin: ORIGIN, host: "evil.example" }] as Array<Record<string, string>>) {
      const res = await enablePOST(post("/api/alerts/enable", headers));
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    expect((await disablePOST(post("/api/alerts/disable", { origin: "https://evil.example" }))).status).toBe(403);
    expect(await isAlertSetupArmed()).toBe(false);
  });

  it("an unarmed browser cannot start the alert sign-in", async () => {
    const res = await startGET(new Request(`${ORIGIN}/api/auth/start?watch=1`));
    expect(locationOf(res).pathname).toBe("/alerts/setup");
    expect(await readOauthHandoff()).toBeNull();
  });

  async function reachCallback(armed: boolean, grantAccount = OWNER) {
    process.env.ALERT_OWNER_BUFFER_ACCOUNT_ID ??= OWNER;
    ACCOUNTS["AT-route-secret"] = grantAccount;
    if (armed) {
      await signIn("owner");
      await enablePOST(post("/api/alerts/enable"));
    }
    // Not armed: write the handoff directly, as if someone crafted the start step.
    const { writeOauthHandoff } = await import("@/auth/session");
    await writeOauthHandoff({ state: "st", verifier: "v", watch: true });
    try {
      return await callbackGET(new Request(`${ORIGIN}/api/auth/callback?code=abc&state=st`));
    } finally {
      ACCOUNTS["AT-route-secret"] = OWNER;
    }
  }

  it("the alert callback stores the grant encrypted, with the owner's account id, and creates NO new browser session", async () => {
    const res = await reachCallback(true);
    expect(locationOf(res).search).toContain("on=1");
    expect(jar.get("pg_sess_n")).toBe("1"); // only the sign-in the owner already had
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(true);
    expect((await storeFromEnv(process.env).store.readSubscriber())?.accountId).toBe(OWNER);
    const stored = JSON.stringify([...redis.data.values()]);
    expect(stored).not.toContain("RT-route-secret");
    expect(stored).not.toContain("AT-route-secret");
    expect(stored).not.toContain(OWNER);
    expect(await isAlertSetupArmed()).toBe(false); // single use
  });

  it("without the arm cookie the callback stores nothing", async () => {
    const res = await reachCallback(false);
    expect(locationOf(res).search).toContain("problem=arm");
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(false);
    expect(redis.data.size).toBe(0);
  });

  it("a Buffer login for a different account in the alert sign-in stores nothing", async () => {
    const res = await reachCallback(true, STRANGER);
    expect(locationOf(res).search).toContain("problem=owner");
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(false);
    expect(redis.data.size).toBe(0);
  });

  it("turning alerts off needs the owner too, then deletes the tokens but keeps the owner id", async () => {
    await reachCallback(true);
    await signIn("stranger");
    const denied = await disablePOST(post("/api/alerts/disable"));
    expect(locationOf(denied).search).toBe("?problem=owner");
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(true);
    await signIn("owner");
    const done = await disablePOST(post("/api/alerts/disable"));
    expect(locationOf(done).search).toContain("off=1");
    expect(await storeFromEnv(process.env).store.isEnabled()).toBe(false);
    const record = await storeFromEnv(process.env).store.readSubscriber();
    expect(record?.refreshToken).toBeNull();
    expect(record?.accessToken).toBeNull();
    expect(record?.accountId).toBe(OWNER);
  });

  it("a normal sign-in can return to the alerts page, and only to an in-app path", async () => {
    await startGET(new Request(`${ORIGIN}/api/auth/start?next=%2Falerts%2Fsetup`));
    expect((await readOauthHandoff())?.next).toBe("/alerts/setup");
    const ok = await callbackGET(new Request(`${ORIGIN}/api/auth/callback?code=abc&state=${(await readOauthHandoff())!.state}`));
    expect(locationOf(ok).pathname).toBe("/alerts/setup");
    await startGET(new Request(`${ORIGIN}/api/auth/start?next=${encodeURIComponent("//evil.example")}`));
    const bad = await callbackGET(new Request(`${ORIGIN}/api/auth/callback?code=abc&state=${(await readOauthHandoff())!.state}`));
    expect(locationOf(bad).pathname).toBe("/dashboard");
  });
});

describe("/api/alerts/unsubscribe", () => {
  async function enabled() {
    await reachCallbackArmed();
    const [owner] = await storeFromEnv(process.env).store.listSubscribers();
    return owner!.unsubscribeToken;
  }
  async function reachCallbackArmed() {
    process.env.ALERT_OWNER_BUFFER_ACCOUNT_ID = OWNER;
    await signIn("owner");
    await enablePOST(post("/api/alerts/enable"));
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
