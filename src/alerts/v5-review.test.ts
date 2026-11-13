/**
 * Review 5 (13 Nov): probes on ff8bc0a. FINDING tests fail on ff8bc0a and pass with patches/alerts-fixes-v5.
 * CHECK tests pass on both and pin behaviour that was only claimed before.
 *
 * Most probes drive the REAL wiring (buildDeps -> handleCron): Upstash REST, the Buffer token endpoint, Buffer GraphQL
 * and Resend are all faked at the fetch level, so the grant, lock, claim, notice and mail code run unmodified.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDeps } from "./deps";
import { FakeRedis } from "./fake-redis";
import { getAccessToken } from "./grant";
import { RedisAlertStore } from "./redis";
import { handleCron, handleUnsubscribe, runAlerts } from "./run";
import type { RunDeps } from "./types";

const HOUR = 3_600_000;
const UPSTASH = "https://upstash.fake";
const MAIL = "https://mail.fake/emails";
const SECRETS = {
  SESSION_SECRET: "v5-session-secret-SESS-0123456789abcdef",
  CRON_SECRET: "v5-cron-secret-CRON-0123456789abcdef",
  KV_REST_API_TOKEN: "v5-upstash-token-KVTOK-0123456789",
  RESEND_API_KEY: "re_v5_RESENDKEY_0123456789",
  REFRESH: "RT-v5-REFRESH-0123456789",
  ACCESS: "AT-v5-ACCESS-0123456789",
};
const ENV = {
  SESSION_SECRET: SECRETS.SESSION_SECRET,
  CRON_SECRET: SECRETS.CRON_SECRET,
  KV_REST_API_URL: UPSTASH,
  KV_REST_API_TOKEN: SECRETS.KV_REST_API_TOKEN,
  RESEND_API_KEY: SECRETS.RESEND_API_KEY,
  MAIL_PROVIDER_URL: MAIL,
  ALERT_EMAIL_TO: "owner@example.test",
  BUFFER_CLIENT_ID: "client-v5",
  APP_URL: "https://postguard.test",
};

type TokenMode = "ok" | "invalid_grant" | "http503" | "network";
type Sent = { body: { to: string[]; subject: string; text: string; html: string; headers: Record<string, string> }; key: string };

/** One fake world behind fetch. Real buildDeps, real RedisAlertStore, real grant.ts, real ResendMailer. */
function world(options: { posts?: number; disconnected?: boolean } = {}) {
  const redis = new FakeRedis();
  const calls = { buffer: [] as string[], token: 0, upstash: 0 };
  const sent: Sent[] = [];
  const mailAttempts: Sent[] = [];
  let tokenMode: TokenMode = "ok";
  let tokenSerial = 0;
  let mailDown = false;
  let bufferMode: "ok" | "http500" = "ok";
  let upstashFails: (args: Array<string | number>) => boolean = () => false;
  const due = new Date(Date.now() + 5 * HOUR).toISOString();
  const node = (id: string) => ({
    id, text: "Studio hours this Thursday.", status: "scheduled", dueAt: due, channelId: "ch1", channelService: "instagram",
    schedulingType: "automatic", error: null, assets: [],
    metadata: { __typename: "InstagramPostMetadata", type: "post", firstComment: "", link: null, annotations: [] },
  });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith(UPSTASH)) {
      calls.upstash += 1;
      const args = JSON.parse(String(init?.body)) as Array<string | number>;
      if (upstashFails(args)) return new Response("down", { status: 500 });
      return Response.json({ result: await redis.command(args) });
    }
    if (url === "https://auth.buffer.com/token") {
      calls.token += 1;
      if (tokenMode === "network") throw new TypeError("fetch failed");
      if (tokenMode === "http503") return new Response("<html>upstream connect error</html>", { status: 503 });
      if (tokenMode === "invalid_grant") return Response.json({ error: "invalid_grant", error_description: `refresh token ${SECRETS.REFRESH} was revoked` }, { status: 400 });
      tokenSerial += 1;
      return Response.json({ access_token: `${SECRETS.ACCESS}-${tokenSerial}`, refresh_token: `${SECRETS.REFRESH}-${tokenSerial}`, expires_in: 3600 });
    }
    if (url.startsWith("https://api.buffer.com")) {
      const body = JSON.parse(String(init?.body)) as { query: string };
      const name = body.query.match(/query (\w+)/)?.[1] ?? "?";
      calls.buffer.push(name);
      const headers = { ratelimit: '"100-in-15min"; r=90; t=400', "ratelimit-policy": '"100-in-15min"; q=100; w=900' };
      if (bufferMode === "http500") return Response.json({ errors: [{ message: `internal ${SECRETS.ACCESS}` }] }, { status: 500 });
      if (name === "PostGuardAccount") return Response.json({ data: { account: { id: "acc", organizations: [{ id: "org1", name: "Cara Elexia" }] } } }, { headers });
      if (name === "PostGuardChannels") return Response.json({ data: { channels: [{ id: "ch1", name: "caraelexia", displayName: "Cara Elexia", service: "instagram", isDisconnected: options.disconnected ?? true, isLocked: false, isQueuePaused: false, timezone: "UTC", metadata: null }] } }, { headers });
      if (name === "PostGuardUndatedPosts") return Response.json({ data: { posts: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } }, { headers });
      const n = options.posts ?? 1;
      return Response.json({ data: { posts: { edges: Array.from({ length: Math.min(n, 50) }, (_, i) => ({ node: node(`p${calls.buffer.length}_${i}`) })), pageInfo: { hasNextPage: n > 50, endCursor: n > 50 ? `c${calls.buffer.length}` : null } } } }, { headers });
    }
    if (url === MAIL) {
      const headers = new Headers(init?.headers);
      const entry: Sent = { body: JSON.parse(String(init?.body)), key: headers.get("idempotency-key") ?? "" };
      mailAttempts.push(entry);
      if (mailDown) return new Response("down", { status: 503 });
      if (!sent.some((s) => s.key === entry.key)) sent.push(entry); // Resend idempotency: same key, one delivery
      return Response.json({ id: `m${sent.length}` });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  // LiveQueueReader -> scanLive uses the GLOBAL fetch for Buffer GraphQL (buildDeps' fetchImpl only reaches Redis, the
  // token endpoint and the mailer), so the global is replaced too: nothing in this file can reach a real host.
  vi.stubGlobal("fetch", fetchImpl);
  const store = new RedisAlertStore(redis, SECRETS.SESSION_SECRET, () => ({ email: "owner@example.test", timeZone: "Europe/Amsterdam" }));
  const request = (q = "") => new Request(`https://postguard.test/api/cron/alerts${q}`, { headers: { authorization: `Bearer ${SECRETS.CRON_SECRET}` } });
  const deps = (q = ""): RunDeps => ({ ...buildDeps(request(q), ENV, fetchImpl), log: { info() {}, warn() {}, error() {} } });
  return {
    redis, store, calls, sent, mailAttempts,
    cron: (q = "") => handleCron(request(q), deps(q)),
    deps,
    /** expiresAt in the past forces a refresh on the first run, like a real daily run with a 1 h access token. */
    enable: (expired = true) => store.enable({ accessToken: SECRETS.ACCESS, refreshToken: SECRETS.REFRESH, expiresAt: expired ? Date.now() - 1000 : Date.now() + 24 * HOUR }),
    setToken: (m: TokenMode) => { tokenMode = m; },
    setMailDown: (d: boolean) => { mailDown = d; },
    setBuffer: (m: "ok" | "http500") => { bufferMode = m; },
    setUpstashFails: (fn: (args: Array<string | number>) => boolean) => { upstashFails = fn; },
  };
}

afterEach(() => { vi.unstubAllGlobals(); });

const everything = (w: ReturnType<typeof world>) => JSON.stringify(w.mailAttempts);
const SECRET_VALUES = [SECRETS.SESSION_SECRET, SECRETS.CRON_SECRET, SECRETS.KV_REST_API_TOKEN, SECRETS.RESEND_API_KEY, SECRETS.REFRESH, SECRETS.ACCESS, "invalid_grant", "upstream connect", "internal"];

// ---------------------------------------------------------------- FINDINGS

describe("FINDING V5-1: the failed-check notice names the right cause", () => {
  it("Buffer's token endpoint 503 (an outage) does NOT tell the owner their sign-in was rejected or send them to set up again", async () => {
    const w = world();
    await w.enable();
    w.setToken("http503");
    const res = await w.cron();
    expect(res.status).toBe(503);
    expect(w.sent).toHaveLength(1);
    const text = w.sent[0]!.body.text;
    expect(text, "an outage is not a rejected sign-in: the stored refresh token was never accepted or spent").not.toMatch(/did not accept/i);
    expect(text).not.toContain("/alerts/setup");
    expect(text).toMatch(/could not (read|reach)|no answer|did not answer/i);
  });

  it("a network failure at the token endpoint is also an outage, not 'turn alerts on again'", async () => {
    const w = world();
    await w.enable();
    w.setToken("network");
    await w.cron();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.body.text).not.toContain("/alerts/setup");
  });

  it("an Upstash blip while reading the grant is not blamed on Buffer", async () => {
    const w = world();
    await w.enable(false);
    let gets = 0;
    // listSubscribers reads the record (ok), the grant read inside the scan fails, the notice claim works again.
    w.setUpstashFails((args) => args[0] === "GET" && String(args[1]).includes(":sub:") && ++gets === 2);
    await w.cron();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]!.body.text, "Buffer was fine; PostGuard's own store failed").not.toMatch(/from Buffer/i);
    expect(w.calls.buffer).toHaveLength(0);
  });
});

describe("FINDING V5-2: no 'today's check did not run' after today's check already ran", () => {
  it("a second run the same UTC day that cannot read Buffer (HTTP 500) sends no notice after a successful check (the alert already went out)", async () => {
    const w = world();
    await w.enable();
    expect((await w.cron()).status).toBe(200);
    expect(w.sent).toHaveLength(1); // the Blocker alert
    w.setBuffer("http500"); // the re-run (manual curl, or a late duplicate delivery) cannot read Buffer
    const second = await w.cron();
    expect(second.status).toBe(503);
    expect(w.sent.map((s) => s.body.subject), "the owner already got today's alert; 'today's check did not run' is false").toHaveLength(1);
  });
});

describe("FINDING V5-3: a real run that overlaps a slow refresh (e.g. a dry run in the cron hour) waits it out", () => {
  it("the second caller waits at least as long as one refresh may take (15 s timeout), instead of failing at ~4.8 s", async () => {
    const redis = new FakeRedis();
    const store = new RedisAlertStore(redis, SECRETS.SESSION_SECRET, () => ({ email: "o@x.test", timeZone: null }));
    await store.enable({ accessToken: "old", refreshToken: "R0", expiresAt: 0 });
    let virtual = 0; // ms the waiting caller has slept
    let refreshes = 0;
    let secondSettled = false;
    const slowRefresh = async (token: string) => {
      refreshes += 1;
      // The first refresh answers after 8 s of (virtual) time: slow, but well inside its own 15 s timeout.
      while (virtual < 8_000 && !secondSettled) await new Promise((r) => setTimeout(r, 0));
      return { accessToken: `A-${token}`, refreshToken: `${token}-next`, expiresAt: Date.now() + HOUR, scope: "x" };
    };
    const deps = { grants: store, refresh: slowRefresh, now: () => new Date(), sleep: async (ms: number) => { virtual += ms; await new Promise((r) => setTimeout(r, 0)); } };
    const first = getAccessToken(deps, "owner");
    await new Promise((r) => setTimeout(r, 5));
    const second = getAccessToken(deps, "owner");
    void second.catch(() => undefined).finally(() => { secondSettled = true; });
    const [a, b] = await Promise.allSettled([first, second]);
    expect(a.status).toBe("fulfilled");
    expect(b.status, "the real run gives up while the other refresh is still inside its timeout: that day is lost (and a notice blames Buffer)").toBe("fulfilled");
    expect(refreshes).toBe(1);
  }, 20_000);
});

// ---------------------------------------------------------------- CHECKS

describe("CHECK: the failed-check notice cannot spam", () => {
  it("three concurrent real deliveries while Buffer rejects the grant: one notice, one refresh attempt, the rest skipped", async () => {
    const w = world();
    await w.enable();
    w.setToken("invalid_grant");
    const statuses = (await Promise.all([w.cron(), w.cron(), w.cron()])).map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 503]); // one failed run + two skipped-locked
    expect(w.sent).toHaveLength(1);
    expect(w.calls.token).toBe(1);
  });

  it("five sequential runs the same day (cron + manual re-runs): one notice; Resend 503 on the first notice does not lose it or double it", async () => {
    const w = world();
    await w.enable();
    w.setToken("invalid_grant");
    w.setMailDown(true);
    await w.cron();
    w.setMailDown(false);
    for (let i = 0; i < 4; i += 1) await w.cron();
    expect(w.sent).toHaveLength(1);
    expect(new Set(w.mailAttempts.map((a) => a.key)).size, "every attempt uses the same idempotency key").toBe(1);
  });

  it("a dry run never sends the notice and never claims it", async () => {
    const w = world();
    await w.enable();
    w.setToken("invalid_grant");
    const res = await w.cron("?dryRun=1");
    expect(res.status).toBe(503);
    expect(w.mailAttempts).toHaveLength(0);
    expect([...w.redis.data.keys()].filter((k) => k.includes(":claim:"))).toHaveLength(0);
  });
});

describe("CHECK: the notice leaks nothing and is honest", () => {
  it("no token, secret, upstream error text or 'Bearer' in the notice (subject, text, html, headers) or the cron response", async () => {
    const w = world();
    await w.enable();
    w.setToken("invalid_grant");
    const res = await w.cron();
    const body = await res.text();
    expect(w.sent).toHaveLength(1);
    for (const value of SECRET_VALUES) {
      expect(everything(w), `notice leaks ${value.slice(0, 10)}`).not.toContain(value);
      expect(body, `cron response leaks ${value.slice(0, 10)}`).not.toContain(value);
    }
    expect(everything(w)).not.toMatch(/Bearer/);
  });

  it("Buffer GraphQL 500 whose error message contains the access token: not in the notice", async () => {
    const w = world();
    await w.enable(false);
    w.setBuffer("http500");
    await w.cron();
    expect(w.sent).toHaveLength(1);
    expect(everything(w)).not.toContain(SECRETS.ACCESS);
  });

  it("wording: says the check did not run, says silence is not an all-clear, never claims PostGuard changed anything, carries one-click unsubscribe", async () => {
    const w = world();
    await w.enable();
    w.setToken("invalid_grant");
    await w.cron();
    const { subject, text, html, headers } = w.sent[0]!.body;
    expect(subject).toBe("PostGuard could not check your Buffer queue today");
    expect(text).toMatch(/did not run/);
    expect(text).toMatch(/no email does not mean nothing is wrong/i);
    expect(`${text}${html}`.replace(/no email does not mean nothing is wrong/gi, "")).not.toMatch(/all clear|nothing (is )?wrong|safe to publish|fixed|paused your|deleted your/i);
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(text).toContain(headers["List-Unsubscribe"]!.slice(1, -1));
  });
});

describe("CHECK: unsubscribe / turn-off silences the notice too", () => {
  it("one-click POST to the notice's own unsubscribe URL: later failing runs send nothing and call neither Buffer nor the token endpoint", async () => {
    const w = world();
    await w.enable();
    w.setToken("invalid_grant");
    await w.cron();
    const link = w.sent[0]!.body.headers["List-Unsubscribe"]!.slice(1, -1);
    const deps = w.deps();
    const res = await handleUnsubscribe(new Request(link, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } }), deps);
    expect(res.status).toBe(200);
    const tokenCalls = w.calls.token;
    // next UTC day would normally send a new notice
    const later = { ...deps, now: () => new Date(Date.now() + 25 * HOUR) };
    const result = await runAlerts(later);
    expect(result.status).toBe("ok");
    expect(w.sent).toHaveLength(1);
    expect(w.calls.token).toBe(tokenCalls);
    expect(w.calls.buffer).toHaveLength(0);
  });
});

describe("CHECK: the notice does not fire when Buffer is fine", () => {
  it("Resend down with a Blocker due: one alert attempt, no notice attempt, claims given back, 503", async () => {
    const w = world();
    await w.enable();
    w.setMailDown(true);
    const res = await w.cron();
    expect(res.status).toBe(503);
    expect(w.mailAttempts).toHaveLength(1);
    expect(w.mailAttempts[0]!.body.subject).toMatch(/attention before publishing/);
    expect([...w.redis.data.keys()].filter((k) => k.includes(":claim:"))).toHaveLength(0);
  });

  it("Upstash down from the start: 503, no Buffer call, no refresh spent, no email", async () => {
    const w = world();
    await w.enable();
    w.setUpstashFails(() => true);
    const res = await w.cron();
    expect(res.status).toBe(503);
    expect(w.calls.token).toBe(0);
    expect(w.calls.buffer).toHaveLength(0);
    expect(w.mailAttempts).toHaveLength(0);
  });

  it("Upstash down at CLAIM time (after a good scan): fails closed, 503, no email, no claim left, refresh token was saved (documented gap: a found Blocker goes unsent that run)", async () => {
    const w = world();
    await w.enable();
    w.setUpstashFails((args) => args[0] === "SET" && String(args[1]).includes(":claim:"));
    const res = await w.cron();
    expect(res.status).toBe(503);
    expect(w.mailAttempts).toHaveLength(0);
    expect([...w.redis.data.keys()].filter((k) => k.includes(":claim:"))).toHaveLength(0);
    const grant = await w.store.readGrant("owner");
    expect(grant?.refreshToken).toBe(`${SECRETS.REFRESH}-1`);
  });
});

describe("CHECK: dry-run lock separation cannot let two real runs overlap", () => {
  it("while a dry run holds its own lock, two real runs still exclude each other (one ok, one skipped-locked, one email)", async () => {
    const w = world();
    await w.enable(false);
    const release = await w.store.acquireLock("alerts-dry-run", 60_000); // a dry run in progress
    expect(release).not.toBeNull();
    const [a, b] = await Promise.all([w.cron(), w.cron()]);
    const bodies = [await a.json(), await b.json()].map((x: { status: string }) => x.status).sort();
    expect(bodies).toEqual(["ok", "skipped-locked"]);
    expect(w.sent).toHaveLength(1);
    await release!();
  });

  it("two dry runs exclude each other too, and neither touches the real-run lock", async () => {
    const w = world();
    await w.enable(false);
    const real = await w.store.acquireLock("alerts-run", 60_000);
    const [a, b] = await Promise.all([w.cron("?dryRun=1"), w.cron("?dryRun=1")]);
    const statuses = [await a.json(), await b.json()].map((x: { status: string }) => x.status).sort();
    expect(statuses).toEqual(["ok", "skipped-locked"]);
    expect(await w.store.acquireLock("alerts-run", 60_000), "the real-run lock is still held by its owner").toBeNull();
    await real!();
  });
});

describe("CHECK: Buffer quota per run", () => {
  it("a normal run: 4 Buffer API requests (account, channels, one posts page, undated) and at most 1 token refresh", async () => {
    const w = world();
    await w.enable();
    await w.cron();
    expect(w.calls.buffer).toEqual(["PostGuardAccount", "PostGuardChannels", "PostGuardPosts", "PostGuardUndatedPosts"]);
    expect(w.calls.token).toBe(1);
  });

  it("a huge queue stops at the page cap: at most 15 Buffer requests per run (2 + 12 pages + undated), well inside 100/15 min", async () => {
    const w = world({ posts: 5000 });
    await w.enable();
    await w.cron();
    expect(w.calls.buffer.length).toBeLessThanOrEqual(15);
  }, 30_000);

  it("dry run + real run in the same hour: two scans (8 requests) but still only one refresh, the token is shared", async () => {
    const w = world();
    await w.enable();
    await w.cron("?dryRun=1");
    await w.cron();
    expect(w.calls.buffer).toHaveLength(8);
    expect(w.calls.token).toBe(1);
  });
});

describe("CHECK: alert links go to the post", () => {
  it("text and html carry the Buffer channel link with ?post=<id> and the PostGuard card link /dashboard?org=<org>#post-<id>, on APP_URL, https, no token", async () => {
    const w = world();
    await w.enable();
    await w.cron();
    expect(w.sent).toHaveLength(1);
    const { text, html } = w.sent[0]!.body;
    const id = text.match(/#post-([\w-]+)/)?.[1];
    expect(id).toBeTruthy();
    expect(text).toContain(`https://publish.buffer.com/channels/ch1?post=${id}`);
    expect(text).toContain(`https://postguard.test/dashboard?org=org1#post-${id}`);
    expect(html).toContain(`https://postguard.test/dashboard?org=org1#post-${id}`);
    expect(html).toContain(`https://publish.buffer.com/channels/ch1?post=${id}`);
    expect(text).toMatch(/Open the channel in Buffer \(find the post at /);
    for (const href of html.match(/href="([^"]+)"/g) ?? []) expect(href).toMatch(/^href="https:\/\//);
    expect(everything(w)).not.toContain(SECRETS.ACCESS);
  });
});
