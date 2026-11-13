/**
 * Review 3 (13 Nov): probes of real failure modes on 91baf47. Tests marked FINDING fail on 91baf47 and pass with
 * patches/alerts-fixes-v3. Tests marked CHECK pass on both and pin behaviour that was only claimed before.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoReport } from "@/demo/build";
import type { ScanReport } from "@/domain/types";
import { BufferRateLimitError } from "@/buffer/client";
import { FakeRedis } from "./fake-redis";
import { formatWhen, renderMessage, untilLabel } from "./message";
import { RedisAlertStore, UpstashRedis } from "./redis";
import { handleCron, handleUnsubscribe, runAlerts } from "./run";
import { horizonFor, selectAlertItems } from "./select";
import type { AlertConfig, Mailer, OutgoingMessage, QueueReader, RunDeps, Subscriber } from "./types";

const HOUR = 3_600_000;
const NOW = new Date("2026-11-13T06:10:00Z");
const SECRET = "v3-review-session-secret-xxxxxxxxxxxxxxxx";
const CRON = "v3-cron-secret-0123456789abcdef";
const CONFIG: AlertConfig = { appUrl: "https://postguard.test", cadenceHours: 24, jitterHours: 1, leadHours: 2 };
const silent = { info() {}, warn() {}, error() {} };

class SlowRedis extends FakeRedis {
  override async command(args: Array<string | number>): Promise<unknown> {
    await new Promise((resolve) => setTimeout(resolve, 3));
    return super.command(args);
  }
}

/** One Blocker/High card from the demo (with its own findings), due at `dueAt`. */
async function oneRiskyPost(dueAt: Date, at: Date = NOW): Promise<ScanReport> {
  const report = await buildDemoReport(at, 7, false);
  const card = report.cards.find((c) => c.priority === "blocker" && c.dueAt && report.findings.some((f) => f.postId === c.id && (f.severity === "blocker" || f.severity === "high")));
  if (!card) throw new Error("demo has no blocker card with findings");
  return { ...report, notes: [], cards: [{ ...card, dueAt: dueAt.toISOString() }] };
}

async function quietReport(at: Date = NOW, notes: string[] = []): Promise<ScanReport> {
  const report = await buildDemoReport(at, 7, false);
  return { ...report, notes, cards: [] };
}

function harness(opts: { redis?: FakeRedis; mailer?: Mailer } = {}) {
  let now = NOW;
  const redis = opts.redis ?? new FakeRedis(() => now.getTime());
  const store = new RedisAlertStore(redis, SECRET, () => ({ email: "owner@example.test", timeZone: "Europe/Amsterdam" }));
  const sent: Array<{ message: OutgoingMessage; key: string }> = [];
  const mailer: Mailer = opts.mailer ?? { configured: () => true, async send(message, { idempotencyKey }) { sent.push({ message, key: idempotencyKey }); return { id: `m${sent.length}` }; } };
  let report: ScanReport | null = null;
  const reader: QueueReader = { scan: async () => { if (!report) throw new Error("no report"); return report; } };
  const deps = (): RunDeps => ({ store, mailer, reader, now: () => now, log: silent, config: CONFIG, sleep: async () => {}, env: { CRON_SECRET: CRON } });
  return {
    redis, store, sent, deps,
    setNow: (d: Date) => { now = d; },
    setReport: (r: ScanReport) => { report = r; },
    enable: () => store.enable({ accessToken: "AT", refreshToken: "RT", expiresAt: NOW.getTime() + 365 * 24 * HOUR }, NOW),
  };
}

const cronRequest = (q = "") => new Request(`https://postguard.test/api/cron/alerts${q}`, { headers: { authorization: `Bearer ${CRON}` } });

// ---------------------------------------------------------------- FINDINGS

describe("FINDING V3-1: a post that was alerted, then rescheduled without being fixed, is alerted again", () => {
  it("the next day's run warns about the new publish time instead of staying silent for 3 days", async () => {
    const h = harness();
    await h.enable();
    h.setReport(await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR)));
    expect((await runAlerts(h.deps())).sent).toBe(1);
    // The owner reads the email, does not fix the post, and moves it to tomorrow evening instead.
    const tomorrow = new Date(NOW.getTime() + 24 * HOUR);
    h.setNow(tomorrow);
    h.setReport(await oneRiskyPost(new Date(tomorrow.getTime() + 12 * HOUR), tomorrow));
    const second = await runAlerts(h.deps());
    expect(second.sent, "still-broken post at a NEW time was suppressed by the 3-day claim, so it publishes broken unwarned").toBe(1);
  });

  it("the same post at the same time is still never emailed twice", async () => {
    const h = harness();
    await h.enable();
    const due = new Date(NOW.getTime() + 26 * HOUR);
    h.setReport(await oneRiskyPost(due));
    expect((await runAlerts(h.deps())).sent).toBe(1);
    h.setNow(new Date(NOW.getTime() + 23.5 * HOUR));
    h.setReport(await oneRiskyPost(due, new Date(NOW.getTime() + 23.5 * HOUR)));
    const again = await runAlerts(h.deps());
    expect(again.sent).toBe(0);
    expect(again.suppressed).toBeGreaterThan(0);
  });
});

describe("FINDING V3-2: an incomplete scan that found nothing is not reported as a clean 'ok'", () => {
  it("no email (silent), but the run result says the check was incomplete", async () => {
    const h = harness();
    await h.enable();
    h.setReport(await quietReport(NOW, ["Stopped early because the Buffer rate-limit window is nearly empty."]));
    const result = await runAlerts(h.deps());
    expect(h.sent).toHaveLength(0);
    expect(result.status, "a quota-truncated scan with nothing found answered a clean ok").not.toBe("ok");
    expect(result.errors.join(" ")).toMatch(/incomplete/i);
    const response = await handleCron(cronRequest(), h.deps());
    expect(response.status).toBe(200); // partial, not a failure: nothing to retry
  });

  it("a complete quiet scan stays a clean ok with no email", async () => {
    const h = harness();
    await h.enable();
    h.setReport(await quietReport(NOW, ["Character limits are the hard-coded table from Buffer's character-limits guide."]));
    const result = await runAlerts(h.deps());
    expect(result).toMatchObject({ status: "ok", sent: 0, errors: [] });
    expect(h.sent).toHaveLength(0);
  });
});

describe("FINDING V3-3: a Redis blip AFTER the email went out does not turn a delivered alert into a failed run", () => {
  it("setLastSuccess failing keeps status ok/partial and sent=1 (was: 'the run crashed', 503)", async () => {
    const h = harness();
    await h.enable();
    h.setReport(await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR)));
    h.store.setLastSuccess = async () => { throw new Error("Alert store answered HTTP 503."); };
    const response = await handleCron(cronRequest(), h.deps());
    const body = await response.json();
    expect(h.sent).toHaveLength(1);
    expect(body.sent).toBe(1);
    expect(response.status, "a delivered alert was reported as a failed run (503)").toBe(200);
  });
});

describe("FINDING V3-4: the run does not start a send it cannot finish before Vercel's 60 s maxDuration", () => {
  it("when the scan used up the time budget, nothing is claimed and the run fails loudly, so tomorrow still alerts", async () => {
    const h = harness();
    await h.enable();
    let clock = 1_000_000;
    const started = clock;
    const report = await oneRiskyPost(new Date(NOW.getTime() + 20 * HOUR));
    const slowReader: QueueReader = { scan: async () => { clock += 52_000; return report; } }; // slow link checks
    const deps = { ...h.deps(), reader: slowReader, clock: () => clock, deadlineAt: started + 55_000 } as RunDeps;
    const result = await runAlerts(deps);
    expect(h.sent, "a send was started with ~3 s left before the function is killed").toHaveLength(0);
    expect(result.status).toBe("failed");
    // Nothing was claimed, so the next run alerts normally.
    const next = await runAlerts({ ...h.deps(), reader: { scan: async () => report } });
    expect(next.sent).toBe(1);
  });

  it("the cron route gives the run a deadline inside maxDuration", () => {
    const route = readFileSync("src/app/api/cron/alerts/route.ts", "utf8");
    const deps = readFileSync("src/alerts/deps.ts", "utf8");
    expect(route).toMatch(/maxDuration = 60/);
    expect(deps, "buildDeps sets no deadline").toMatch(/deadlineAt/);
  });
});

// ---------------------------------------------------------------- CHECKS (pass on 91baf47 too)

describe("CHECK: Vercel delivers the cron twice at the same moment, through the route handler", () => {
  it("one email, one run, the other answers 200 skipped-locked; the lock is gone afterwards", async () => {
    let mails = 0;
    const slowMailer: Mailer = { configured: () => true, async send() { await new Promise((r) => setTimeout(r, 30)); mails += 1; return { id: "m" }; } };
    const h = harness({ redis: new SlowRedis(() => Date.now()), mailer: slowMailer });
    await h.enable();
    h.setReport(await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR)));
    const [a, b] = await Promise.all([handleCron(cronRequest(), h.deps()), handleCron(cronRequest(), h.deps())]);
    const bodies = [await a.json(), await b.json()];
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(bodies.map((x) => x.status).sort()).toEqual(["ok", "skipped-locked"]);
    expect(mails).toBe(1);
    expect([...h.redis.data.keys()].some((k) => k.includes(":lock:"))).toBe(false);
    // and a third delivery a minute later sends nothing new
    const c = await (await handleCron(cronRequest(), h.deps())).json();
    expect(c).toMatchObject({ status: "ok", sent: 0 });
    expect(mails).toBe(1);
  });

  it("a run killed mid-way (lock never released) blocks reruns for at most the 10-minute lock, then runs", async () => {
    let t = NOW.getTime();
    const h = harness({ redis: new FakeRedis(() => t) });
    await h.enable();
    h.setReport(await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR)));
    await h.store.acquireLock("alerts-run", 10 * 60_000); // the killed run's lock
    expect((await runAlerts(h.deps())).status).toBe("skipped-locked");
    t += 10 * 60_000 + 1;
    expect((await runAlerts(h.deps())).sent).toBe(1);
  });
});

describe("CHECK: DST nights and the 27-hour edge", () => {
  it("labels both 02:30s on 25 Oct and the jump on 29 Mar correctly", () => {
    expect(formatWhen("2026-10-25T00:30:00Z", "Europe/Amsterdam")).toContain("02:30 CEST");
    expect(formatWhen("2026-10-25T01:30:00Z", "Europe/Amsterdam")).toContain("02:30 CET");
    expect(formatWhen("2026-03-29T01:30:00Z", "Europe/Amsterdam")).toContain("03:30 CEST");
    // 07:00 CEST on 24 Oct to 07:00 CET on 25 Oct is 25 real hours, not 24
    expect(untilLabel("2026-10-25T06:00:00Z", new Date("2026-10-24T05:00:00Z"))).toBe("in about 25 hours");
  });

  it("includes a post due exactly at now+27h and excludes one 1 ms later, also across the October change", async () => {
    const now = new Date("2026-10-24T06:30:00Z");
    const horizonEnd = horizonFor(CONFIG, now);
    expect(horizonEnd.toISOString()).toBe("2026-10-25T09:30:00.000Z");
    const subscriber = { id: "owner" };
    const at = await oneRiskyPost(horizonEnd, now);
    const after = await oneRiskyPost(new Date(horizonEnd.getTime() + 1), now);
    expect(selectAlertItems(at, subscriber, { now, horizonEnd, appUrl: CONFIG.appUrl }).length).toBeGreaterThan(0);
    expect(selectAlertItems(after, subscriber, { now, horizonEnd, appUrl: CONFIG.appUrl })).toHaveLength(0);
  });
});

describe("CHECK: Buffer 429 mid-scan and Resend 429/5xx", () => {
  it("Buffer 429 fails the run with 503 and Retry-After, nothing claimed or sent", async () => {
    const h = harness();
    await h.enable();
    const deps = { ...h.deps(), reader: { scan: async () => { throw new BufferRateLimitError(120); } } };
    const response = await handleCron(cronRequest(), deps);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("120");
    // Review 4: the only claim is the one "today's check did not run" notice (V4-1); no alert item is claimed.
    expect([...h.redis.data.keys()].filter((k) => k.includes(":claim:"))).toHaveLength(1);
    expect(h.sent.map((s) => s.message.subject)).toEqual(["PostGuard could not check your Buffer queue today"]);
  });

  it("Resend 429 today: claims released; tomorrow the same items go out once with the same idempotency key", async () => {
    let fail = true;
    const keys: string[] = [];
    const mailer: Mailer = { configured: () => true, async send(_m, { idempotencyKey }) { keys.push(idempotencyKey); if (fail) throw new Error("The mail provider answered HTTP 429."); return { id: "ok" }; } };
    const h = harness({ mailer });
    await h.enable();
    const due = new Date(NOW.getTime() + 26 * HOUR);
    h.setReport(await oneRiskyPost(due));
    expect((await handleCron(cronRequest(), h.deps())).status).toBe(503);
    fail = false;
    const tomorrow = new Date(NOW.getTime() + 23.5 * HOUR);
    h.setNow(tomorrow);
    h.setReport(await oneRiskyPost(due, tomorrow));
    const body = await (await handleCron(cronRequest(), h.deps())).json();
    expect(body.sent).toBe(1);
    expect(keys[0]).toBe(keys[1]);
  });
});

describe("CHECK: Upstash answering HTTP 200 with an error body", () => {
  it("is an error, never read as 'already claimed' (which would silently suppress the alert)", async () => {
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const [name, , ...rest] = JSON.parse(String(init.body));
      if (name === "SET" && rest.includes("NX") && String(JSON.parse(String(init.body))[1]).includes(":claim:")) {
        return new Response(JSON.stringify({ error: "ERR max requests limit exceeded" }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: name === "SET" ? "OK" : null }), { status: 200 });
    }) as unknown as typeof fetch;
    const redis = new UpstashRedis("https://redis.test", "tok", fetchImpl);
    await expect(redis.command(["SET", "pg:alerts:claim:x", "1", "NX", "PX", 1])).rejects.toThrow(/error/);
  });
});

describe("CHECK: escaping of post text and channel names in the email", () => {
  it("HTML-escapes channel name, caption and finding text; the subject carries no user text", async () => {
    const report = await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR));
    const evil = `<img src=x onerror=alert(1)>"'`;
    const card = { ...report.cards[0]!, channelName: evil, excerpt: `</p><script>alert(2)</script> caption` };
    const items = selectAlertItems({ ...report, cards: [card] }, { id: "owner" }, { now: NOW, horizonEnd: horizonFor(CONFIG, NOW), appUrl: CONFIG.appUrl })
      .map((i) => ({ ...i, title: `<b>${i.title}</b>` }));
    const sub: Subscriber = { id: "owner", email: "o@e.test", organizationId: "", timeZone: "Europe/Amsterdam", unsubscribed: false, unsubscribeToken: "t".repeat(43), credentials: { accessToken: "", refreshToken: null, expiresAt: 0 } };
    const m = renderMessage(items, sub, { now: NOW, appUrl: CONFIG.appUrl, report });
    expect(m.html).not.toMatch(/<img|<script|<b>/);
    expect(m.html).toContain("&lt;img src=x onerror=alert(1)&gt;&quot;&#39;");
    expect(m.subject).not.toMatch(/img|script/);
  });
});

describe("CHECK: unsubscribe token after turning alerts off and on again", () => {
  it("an old email's link no longer works after re-enable (404) and alerts stay on; the new link works", async () => {
    const h = harness();
    await h.enable();
    const [first] = await h.store.listSubscribers();
    const oldToken = first!.unsubscribeToken;
    const post = (token: string) => handleUnsubscribe(new Request(`https://postguard.test/api/alerts/unsubscribe?token=${token}`, { method: "POST" }), h.deps());
    expect((await post(oldToken)).status).toBe(200);
    await h.enable(); // owner turns alerts on again at /alerts/setup
    expect((await post(oldToken)).status).toBe(404);
    expect(await h.store.isEnabled()).toBe(true);
    const [again] = await h.store.listSubscribers();
    expect((await post(again!.unsubscribeToken)).status).toBe(200);
    expect(await h.store.isEnabled()).toBe(false);
  });
});

describe("CHECK: 'nothing to send' sends nothing and claims nothing", () => {
  it("no mailer call, no claim keys", async () => {
    let calls = 0;
    const h = harness({ mailer: { configured: () => true, async send() { calls += 1; return { id: "x" }; } } });
    await h.enable();
    h.setReport(await quietReport());
    const result = await runAlerts(h.deps());
    expect(result).toMatchObject({ status: "ok", sent: 0 });
    expect(calls).toBe(0);
    expect(h.redis.commands.filter((c) => c[0] === "SET" && String(c[1]).includes(":claim:"))).toHaveLength(0);
  });
});

describe("CHECK: read-only promise, nothing writes to Buffer", () => {
  it("no GraphQL mutation and no non-POST/GET verb toward api.buffer.com anywhere in src (tests excluded)", () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p) && !p.includes("fake")) files.push(p); } };
    walk("src");
    const offenders = files.filter((f) => /\bmutation\b\s*[A-Za-z{(]/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
    const client = readFileSync("src/buffer/client.ts", "utf8");
    expect(client).not.toMatch(/method:\s*["'](PUT|PATCH|DELETE)["']/);
  });

  it("the alert links point at the exact post: Buffer ?post=<id> and PostGuard #post-<id> with the org", async () => {
    const report = await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR));
    const [item] = selectAlertItems(report, { id: "owner" }, { now: NOW, horizonEnd: horizonFor(CONFIG, NOW), appUrl: CONFIG.appUrl });
    const card = report.cards[0]!;
    expect(item!.fixUrl).toBe(`https://publish.buffer.com/channels/${encodeURIComponent(card.channelId)}?post=${encodeURIComponent(card.id)}`);
    expect(new URL(item!.cardUrl).hash).toBe(`#post-${card.id}`);
    expect(new URL(item!.cardUrl).searchParams.get("org")).toBe(report.organization.id);
  });
});
