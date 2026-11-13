/**
 * Review 4 (13 Nov): probes on 950bcac. FINDING tests fail on 950bcac and pass with patches/alerts-fixes-v4.
 * CHECK tests pass on both and pin behaviour that was only claimed before.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoReport } from "@/demo/build";
import type { ScanReport } from "@/domain/types";
import { BufferAuthError, BufferRateLimitError } from "@/buffer/client";
import { FakeRedis } from "./fake-redis";
import { formatWhen, renderMessage } from "./message";
import { RedisAlertStore } from "./redis";
import { handleCron, runAlerts } from "./run";
import { horizonFor, selectAlertItems } from "./select";
import type { AlertConfig, Mailer, OutgoingMessage, QueueReader, RunDeps } from "./types";

const HOUR = 3_600_000;
const NOW = new Date("2026-11-13T06:10:00Z");
const SECRET = "v4-review-session-secret-xxxxxxxxxxxxxxxx";
const CRON = "v4-cron-secret-0123456789abcdef";
const CONFIG: AlertConfig = { appUrl: "https://postguard.test", cadenceHours: 24, jitterHours: 1, leadHours: 2 };
const silent = { info() {}, warn() {}, error() {} };
const ROOT = path.resolve(__dirname, "../..");

async function oneRiskyPost(dueAt: Date, at: Date = NOW): Promise<ScanReport> {
  const report = await buildDemoReport(at, 7, false);
  const card = report.cards.find((c) => c.priority === "blocker" && c.dueAt && report.findings.some((f) => f.postId === c.id && (f.severity === "blocker" || f.severity === "high")));
  if (!card) throw new Error("demo has no blocker card with findings");
  return { ...report, notes: [], cards: [{ ...card, dueAt: dueAt.toISOString() }] };
}

function harness() {
  let now = NOW;
  const redis = new FakeRedis(() => now.getTime());
  const store = new RedisAlertStore(redis, SECRET, () => ({ email: "owner@example.test", timeZone: "Europe/Amsterdam" }));
  const sent: Array<{ message: OutgoingMessage; key: string }> = [];
  let mailerDown = false;
  const mailer: Mailer = {
    configured: () => true,
    async send(message, { idempotencyKey }) {
      if (mailerDown) throw new Error("The mail provider answered HTTP 503.");
      sent.push({ message, key: idempotencyKey });
      return { id: `m${sent.length}` };
    },
  };
  let scan: () => Promise<ScanReport> = async () => { throw new Error("no report"); };
  const reader: QueueReader = { scan: () => scan() };
  const deps = (): RunDeps => ({ store, mailer, reader, now: () => now, log: silent, config: CONFIG, sleep: async () => {}, env: { CRON_SECRET: CRON } });
  return {
    store, sent, deps,
    setNow: (d: Date) => { now = d; },
    setScan: (fn: () => Promise<ScanReport>) => { scan = fn; },
    setMailerDown: (down: boolean) => { mailerDown = down; },
    enable: () => store.enable({ accessToken: "AT", refreshToken: "RT", expiresAt: NOW.getTime() + 365 * 24 * HOUR }, NOW),
  };
}

const cronRequest = (q = "") => new Request(`https://postguard.test/api/cron/alerts${q}`, { headers: { authorization: `Bearer ${CRON}` } });

// ---------------------------------------------------------------- FINDINGS

describe("FINDING V4-1: when the daily check cannot read Buffer, the owner is told instead of hearing silence", () => {
  it("a revoked or rejected alert grant sends ONE 'could not check' email with the setup link; the run still fails (503)", async () => {
    const h = harness();
    await h.enable();
    h.setScan(async () => { throw new BufferAuthError("Buffer did not accept the saved alert token. Turn alerts on again at /alerts/setup."); });
    const response = await handleCron(cronRequest(), h.deps());
    expect(response.status).toBe(503);
    expect(h.sent.length, "silence after a revoked grant reads as 'all clear' to the owner, for every day until they notice").toBe(1);
    const { message } = h.sent[0]!;
    expect(message.subject).toMatch(/could not check/i);
    expect(message.text).toContain("https://postguard.test/alerts/setup");
    expect(message.text).toMatch(/no email does not mean/i);
    expect(message.headers["List-Unsubscribe"]).toContain("/api/alerts/unsubscribe?token=");
    expect(message.text).not.toMatch(/\bRT\b|\bAT\b|Bearer/);
  });

  it("Buffer down (network/5xx) and Buffer 429 also tell the owner, without claiming the grant is broken", async () => {
    for (const error of [new Error("fetch failed"), new BufferRateLimitError(900)]) {
      const h = harness();
      await h.enable();
      h.setScan(async () => { throw error; });
      await runAlerts(h.deps());
      expect(h.sent.length).toBe(1);
      expect(h.sent[0]!.message.text).not.toMatch(/turn alerts on again/i);
    }
  });

  it("at most one such email per day; a failure on the next day sends one more", async () => {
    const h = harness();
    await h.enable();
    h.setScan(async () => { throw new BufferAuthError(); });
    await runAlerts(h.deps());
    h.setNow(new Date(NOW.getTime() + 2 * HOUR)); // a manual re-run the same day
    await runAlerts(h.deps());
    expect(h.sent.length).toBe(1);
    h.setNow(new Date(NOW.getTime() + 24 * HOUR));
    await runAlerts(h.deps());
    expect(h.sent.length).toBe(2);
  });

  it("if that email cannot be sent either, the next run may try again (the claim is given back)", async () => {
    const h = harness();
    await h.enable();
    h.setScan(async () => { throw new BufferAuthError(); });
    h.setMailerDown(true);
    expect((await runAlerts(h.deps())).status).toBe("failed");
    h.setMailerDown(false);
    h.setNow(new Date(NOW.getTime() + HOUR));
    await runAlerts(h.deps());
    expect(h.sent.length).toBe(1);
  });

  it("a dry run never emails about a failed check", async () => {
    const h = harness();
    await h.enable();
    h.setScan(async () => { throw new BufferAuthError(); });
    await runAlerts(h.deps(), { dryRun: true });
    expect(h.sent.length).toBe(0);
  });
});

describe("FINDING V4-2: a dry run during the cron hour must not make that day's real run skip", () => {
  it("the real run is not 'skipped-locked' while a dry run is in progress", async () => {
    const h = harness();
    await h.enable();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const report = await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR));
    h.setScan(async () => { await gate; return report; });
    const dry = runAlerts(h.deps(), { dryRun: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const real = runAlerts(h.deps());
    await new Promise((resolve) => setTimeout(resolve, 5));
    open();
    const [, realResult] = await Promise.all([dry, real]);
    expect(realResult.status, "the Hobby cron fires once a day and is not retried: a skip is a lost day, reported as 200").not.toBe("skipped-locked");
    expect(realResult.sent).toBe(1);
  });

  it("two real runs still exclude each other", async () => {
    const h = harness();
    await h.enable();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const report = await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR));
    h.setScan(async () => { await gate; return report; });
    const a = runAlerts(h.deps());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = runAlerts(h.deps());
    open();
    const statuses = (await Promise.all([a, b])).map((r) => r.status).sort();
    expect(statuses).toEqual(["ok", "skipped-locked"]);
    expect(h.sent.length).toBe(1);
  });
});

describe("FINDING V4-3: copy says only what is true", () => {
  it("the plain-text email does not promise to open 'this post' when the link is the channel page", async () => {
    const report = await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR));
    const items = selectAlertItems(report, { id: "owner" }, { now: NOW, horizonEnd: horizonFor(CONFIG, NOW), appUrl: CONFIG.appUrl });
    expect(items[0]!.fixUrl).toMatch(/^https:\/\/publish\.buffer\.com\/channels\/[^/?]+\?post=/);
    const message = renderMessage(items, { id: "owner", email: "o@x.test", organizationId: "", timeZone: "Europe/Amsterdam", unsubscribed: false, unsubscribeToken: "t".repeat(30), credentials: { accessToken: "", refreshToken: null, expiresAt: 0 } }, { now: NOW, appUrl: CONFIG.appUrl, report });
    expect(message.text, "Buffer documents no ?post= deep link; the link opens the channel's queue").not.toMatch(/open this post in buffer/i);
  });

  it("the setup page names every scope the alert sign-in asks for, including offline_access", () => {
    const page = readFileSync(path.join(ROOT, "src/app/alerts/setup/page.tsx"), "utf8");
    const oauth = readFileSync(path.join(ROOT, "src/auth/oauth.ts"), "utf8");
    const scopes = /DEFAULT_SCOPE = "([^"]+)"/.exec(oauth)![1]!.split(" ");
    for (const scope of scopes) expect(page, `setup page omits ${scope}`).toContain(`<code>${scope}</code>`);
  });
});

// ---------------------------------------------------------------- CHECKS

describe("CHECK: times, wording and platform config", () => {
  it("a post on a New York channel is shown at the correct instant in the owner's zone, labelled", () => {
    // 10:00 in New York on 14 Nov (EST, UTC-5) = 15:00 UTC = 16:00 CET.
    expect(formatWhen("2026-11-14T15:00:00Z", "Europe/Amsterdam")).toBe("Sat 14 Nov, 16:00 CET (Europe/Amsterdam)");
  });

  it("the alert email never says 'all clear', 'watching', 'monitor' or 'dead'", async () => {
    const report = await oneRiskyPost(new Date(NOW.getTime() + 5 * HOUR));
    const items = selectAlertItems(report, { id: "owner" }, { now: NOW, horizonEnd: horizonFor(CONFIG, NOW), appUrl: CONFIG.appUrl });
    const m = renderMessage(items, { id: "owner", email: "o@x.test", organizationId: "", timeZone: "Europe/Amsterdam", unsubscribed: false, unsubscribeToken: "t".repeat(30), credentials: { accessToken: "", refreshToken: null, expiresAt: 0 } }, { now: NOW, appUrl: CONFIG.appUrl, report, hoursAhead: 27 });
    const scaffold = (m.subject + m.text).replace(/\[(Blocker|High)\][^\n]*/g, "");
    expect(scaffold).not.toMatch(/all clear|watching|monitor|\bdead\b/i);
  });

  it("vercel.json has exactly one daily cron on the alert route; the route is dynamic with maxDuration <= 300", () => {
    const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(vercel.crons).toEqual([{ path: "/api/cron/alerts", schedule: "0 6 * * *" }]);
    const route = readFileSync(path.join(ROOT, "src/app/api/cron/alerts/route.ts"), "utf8");
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
    const max = Number(/export const maxDuration = (\d+)/.exec(route)![1]);
    expect(max).toBeLessThanOrEqual(300);
    expect(route).toMatch(/export async function GET/);
  });

  it("CRON_SECRET pasted with a trailing newline still matches the header Vercel sends", async () => {
    const h = harness();
    const deps = { ...h.deps(), env: { CRON_SECRET: `${CRON}\n` } };
    expect((await handleCron(cronRequest(), deps)).status).toBe(200);
  });

  it("the same alert retried on the next day reuses its idempotency key (Resend keeps keys 24 h, so a 23 h gap can answer 409)", async () => {
    const h = harness();
    await h.enable();
    const due = new Date(NOW.getTime() + 26 * HOUR);
    h.setScan(async () => oneRiskyPost(due));
    h.setMailerDown(true);
    await runAlerts(h.deps());
    h.setMailerDown(false);
    const next = new Date(NOW.getTime() + 23 * HOUR);
    h.setNow(next);
    h.setScan(async () => oneRiskyPost(due, next));
    await runAlerts(h.deps());
    expect(h.sent.length).toBe(1);
    expect(h.sent[0]!.key).toMatch(/^[0-9a-f]{64}$/);
  });
});
