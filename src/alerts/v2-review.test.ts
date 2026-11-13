import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { TokenSet } from "@/auth/oauth";
import { buildDemoReport } from "@/demo/build";
import type { ScanReport } from "@/domain/types";
import { FakeRedis } from "./fake-redis";
import { getAccessToken } from "./grant";
import { ResendMailer } from "./mailer";
import { refreshAccessToken } from "@/auth/oauth";
import { incompleteNotes } from "./message";
import { RedisAlertStore, UpstashRedis } from "./redis";
import { runAlerts } from "./run";
import type { AlertConfig, Mailer, QueueReader, RunDeps } from "./types";

const NOW = new Date("2026-11-12T08:00:00Z");
const SECRET = "v2-review-session-secret-xxxxxxxxxxxxxxxx";
const CONFIG: AlertConfig = { appUrl: "https://postguard.test", cadenceHours: 24, jitterHours: 1, leadHours: 2 };
const silent = { info() {}, warn() {}, error() {} };

/** Redis with real latency, so overlapping callers really interleave. */
class SlowRedis extends FakeRedis {
  override async command(args: Array<string | number>): Promise<unknown> {
    await new Promise((resolve) => setTimeout(resolve, 3));
    return super.command(args);
  }
}

async function reportInWindow(): Promise<ScanReport> {
  const report = await buildDemoReport(NOW, 7, false);
  const cards = report.cards.map((card, index) => ({ ...card, dueAt: new Date(NOW.getTime() + (index + 1) * 600_000).toISOString() }));
  return { ...report, cards };
}

function harness(mailer?: Mailer, redis: FakeRedis = new FakeRedis(() => NOW.getTime())) {
  const store = new RedisAlertStore(redis, SECRET, () => ({ email: "owner@example.test", timeZone: "Europe/Amsterdam" }));
  const sent: string[] = [];
  const mail: Mailer = mailer ?? { async send(message) { sent.push(message.subject); return { id: "m" }; } };
  const deps = (report: ScanReport): RunDeps => {
    const reader: QueueReader = { scan: async () => report };
    return { store, mailer: mail, reader, now: () => NOW, log: silent, config: CONFIG, sleep: async () => {}, env: {} };
  };
  return { redis, store, sent, deps, enable: () => store.enable({ accessToken: "AT", refreshToken: "RT", expiresAt: NOW.getTime() + 3_600_000 }, NOW) };
}

describe("re-check of B1: the real Redis store, overlapping callers, a token server that revokes on replay", () => {
  it("three concurrent refreshes spend the single-use token once and the grant survives", async () => {
    const h = harness(undefined, new SlowRedis(() => Date.now()));
    await h.store.enable({ accessToken: "AT0", refreshToken: "RT0", expiresAt: Date.now() - 1000 });
    const server = { current: "RT0", revoked: false, calls: 0 };
    const refresh = async (token: string): Promise<TokenSet> => {
      server.calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (server.revoked || token !== server.current) {
        server.revoked = true;
        throw new Error("invalid_grant");
      }
      server.current = `RT${server.calls}`;
      return { accessToken: `AT${server.calls}`, refreshToken: server.current, expiresAt: Date.now() + 3_600_000, scope: "posts:read" };
    };
    const deps = { grants: h.store, refresh, now: () => new Date(), sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 5))) };
    const results = await Promise.all([getAccessToken(deps, "owner"), getAccessToken(deps, "owner"), getAccessToken(deps, "owner")]);
    expect(server.revoked).toBe(false);
    expect(server.calls).toBe(1);
    expect(new Set(results).size).toBe(1);
  });
});

describe("re-check of B6 with the REAL note strings the scan writes (src/scan/live.ts)", () => {
  const partial = [
    "Stopped after 5 pages (50 requested per page). A large queue may be incomplete.",
    "Stopped early because the Buffer rate-limit window is nearly empty.",
    "More than one page of posts has no publish time. Only the first page of those was read, to save quota.",
    "Posts with no publish time could not be loaded. Dated posts in the window were still checked.",
    "2 posts came back from Buffer in a shape PostGuard could not read and were left out of this scan.",
    "Link checks failed before they finished. Posts were still checked for everything that does not need HTTP.",
    "12 URLs were not checked, to keep this scan inside a short function timeout.",
    "Scanning Northwind. This account has 2 organizations; only one is included per scan.",
  ];
  it.each(partial)("flags: %s", (note) => {
    expect(incompleteNotes({ notes: [note] })).toEqual([note]);
  });
  it("does not flag informational notes", () => {
    expect(incompleteNotes({ notes: ["Drafts are hidden. Turn on Include drafts to check a post before it is scheduled."] })).toEqual([]);
  });
});

describe("N1: a failure while claiming must not swallow alerts", () => {
  it("releases the claims it already took when a later claim fails, so the next run still alerts", async () => {
    const report = await reportInWindow();
    const h = harness();
    await h.enable();
    const realClaim = h.store.claim.bind(h.store);
    let calls = 0;
    h.store.claim = async (key, ttl) => {
      calls += 1;
      if (calls === 3) throw new Error("Alert store answered HTTP 503.");
      return realClaim(key, ttl);
    };
    const first = await runAlerts(h.deps(report));
    expect(first.status).toBe("failed");
    expect(h.sent).toHaveLength(0);
    h.store.claim = realClaim;
    const second = await runAlerts(h.deps(report));
    expect(second.sent, "alerts claimed before the failure were lost for 3 days").toBe(1);
    expect(second.suppressed).toBe(0);
  });

  it("releases the claims when rendering the email throws", async () => {
    const report = await reportInWindow();
    const h = harness();
    await h.enable();
    const bad = { ...report, notes: [{ toString() { throw new Error("boom"); } } as unknown as string] };
    // notes that cannot be read make the renderer throw after the claims were taken
    const first = await runAlerts(h.deps(bad));
    expect(first.status).toBe("failed");
    const second = await runAlerts(h.deps(report));
    expect(second.sent).toBe(1);
  });
});

describe("N2: nothing in the alert path may hang until Vercel kills the function (claims and the run lock would be held)", () => {
  it("the Resend call has a timeout signal", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "e" })));
    await new ResendMailer({ apiKey: "re_x", from: "a@b.c" }, fetchImpl as unknown as typeof fetch).send(
      { to: "me@example.test", subject: "s", text: "t", html: "h", headers: {} },
      { idempotencyKey: "k" },
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal, "Resend fetch has no AbortSignal").toBeDefined();
  });

  it("every Upstash call has a timeout signal", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ result: "OK" })));
    await new UpstashRedis("https://redis.test", "tok", fetchImpl as unknown as typeof fetch).command(["GET", "k"]);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal, "Upstash fetch has no AbortSignal").toBeDefined();
  });

  it("the Buffer token refresh has a timeout signal too", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ access_token: "a", expires_in: 3600, refresh_token: "r" })));
    await refreshAccessToken({ refreshToken: "r0", clientId: "c", fetchImpl: fetchImpl as unknown as typeof fetch });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal, "token endpoint fetch has no AbortSignal").toBeDefined();
  });

  it("a hanging mail provider ends in a failed run that releases its claims", async () => {
    const report = await reportInWindow();
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const mailer = new ResendMailer({ apiKey: "re_x", from: "a@b.c", timeoutMs: 20 } as never, hang);
    const h = harness(mailer);
    await h.enable();
    const result = await runAlerts(h.deps(report));
    expect(result.status).toBe("failed");
    const retry = await runAlerts({ ...h.deps(report), mailer: { async send() { return { id: "ok" }; } } });
    expect(retry.sent).toBe(1);
  });
});

describe("N3: the owner gate says nothing about the deployment to someone who is not the owner", () => {
  it("a cross-site POST gets 403 and a bare 'not from PostGuard', even when Redis is not configured", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    const { POST } = await import("@/app/api/alerts/enable/route");
    const response = await POST(new Request("https://postguard.test/api/alerts/enable", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("This request did not come from PostGuard.");
    vi.unstubAllEnvs();
  });
});

describe("N4: the privacy page lists everything the alert keeps", () => {
  it("names the short-lived access token as well as the refresh token", () => {
    const page = readFileSync("src/app/privacy/page.tsx", "utf8").replace(/\s+/g, " ");
    expect(page).toMatch(/access token/i);
    expect(page).toMatch(/refresh token/i);
    const alertParagraph = page.slice(page.indexOf("Alert emails are different"));
    expect(alertParagraph.slice(0, 1400)).toMatch(/short-lived access token|access token/i);
  });
});
