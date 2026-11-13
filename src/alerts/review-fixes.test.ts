import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { open, seal } from "@/auth/seal";
import { buildDemoReport } from "@/demo/build";
import type { ScanReport } from "@/domain/types";
import { GRANT_KEY_LABEL, UnreadableGrantError, grantKey, openGrant, sealGrant } from "./crypto";
import { FakeRedis } from "./fake-redis";
import { ResendMailer } from "./mailer";
import { RedisAlertStore, OWNER_ID } from "./redis";
import { runAlerts, handleCron } from "./run";
import { selectAlertItems, horizonFor } from "./select";
import type { AlertConfig, Mailer, QueueReader, RunDeps } from "./types";
import { getAccessToken, type GrantStore } from "./grant";
import type { TokenSet } from "@/auth/oauth";

/**
 * Ported from the controller's fixes for the first alerts commit (B1-B9), rewritten against the current design.
 * B1 (single-flight refresh) lives in grant.test.ts and redis.test.ts.
 */
const NOW = new Date("2026-11-12T08:00:00Z");
const SECRET = "review-fixes-session-secret-xxxxxxxxxxxx";
const CONFIG: AlertConfig = { appUrl: "https://postguard.test", cadenceHours: 24, jitterHours: 1, leadHours: 2 };
const silent = { info() {}, warn() {}, error() {} };
const PARTIAL = "Stopped early because the Buffer rate-limit window is nearly empty.";

async function reportInWindow(notes: string[] = []): Promise<ScanReport> {
  const report = await buildDemoReport(NOW, 7, false);
  // Put every Blocker/High card inside the 27 hour window, so the test is about WHICH posts, not about the clock.
  const cards = report.cards.map((card, index) => ({ ...card, dueAt: new Date(NOW.getTime() + (index + 1) * 600_000).toISOString() }));
  return { ...report, cards, notes };
}

function harness(options: { report?: ScanReport; mailer?: Mailer; email?: string; withSubscriber?: boolean } = {}) {
  const redis = new FakeRedis(() => NOW.getTime());
  const store = new RedisAlertStore(redis, SECRET, () => ({ email: options.email ?? "owner@example.test", timeZone: "Europe/Amsterdam" }));
  const sent: Array<{ message: { html: string; text: string }; idempotencyKey: string }> = [];
  const mailer: Mailer = options.mailer ?? {
    async send(message, { idempotencyKey }) {
      sent.push({ message, idempotencyKey });
      return { id: "m1" };
    },
  };
  const reader: QueueReader = { scan: async () => options.report! };
  const deps: RunDeps = { store, mailer, reader, now: () => NOW, log: silent, config: CONFIG, sleep: async () => {}, env: {} };
  return { redis, store, sent, deps, ready: () => (options.withSubscriber === false ? Promise.resolve() : store.enable({ accessToken: "AT", refreshToken: "RT", expiresAt: NOW.getTime() + 3_600_000 }, NOW)) };
}

describe("B2: with no alert store nothing spends a Buffer token", () => {
  it("a live run with no Redis configured answers 200 'ok', reads no queue, sends nothing and calls no token endpoint", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async () => {
      throw new Error("no network call expected");
    }) as typeof fetch);
    const { buildDeps } = await import("./deps");
    const request = new Request("https://postguard.test/api/cron/alerts", { headers: { authorization: `Bearer ${"x".repeat(20)}` } });
    const deps = buildDeps(request, { CRON_SECRET: "x".repeat(20), SESSION_SECRET: SECRET, BUFFER_CLIENT_ID: "c", RESEND_API_KEY: "re_x", ALERT_EMAIL_TO: "me@example.test" });
    const response = await handleCron(request, deps);
    expect(response.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("B3: a stored grant that cannot be decrypted", () => {
  it("is an error, not 'empty': the run fails (5xx) and never calls Buffer's token endpoint", async () => {
    const h = harness({ report: await reportInWindow() });
    await h.ready();
    const rotated = new RedisAlertStore(h.redis, "a-different-session-secret-xxxxxxxxxxxxxxxx", () => ({ email: "owner@example.test", timeZone: null }));
    await expect(rotated.readSubscriber()).rejects.toBeInstanceOf(UnreadableGrantError);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await runAlerts({ ...h.deps, store: rotated });
    expect(result.status).toBe("failed");
    expect(result.errors.join(" ")).toMatch(/cannot be read/);
    expect(h.sent).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("the owner can still turn alerts off, which removes the unreadable value", async () => {
    const h = harness({ report: await reportInWindow() });
    await h.ready();
    const rotated = new RedisAlertStore(h.redis, "a-different-session-secret-xxxxxxxxxxxxxxxx", () => ({ email: "owner@example.test", timeZone: null }));
    await rotated.disable();
    expect(await rotated.readSubscriber()).toBeNull();
  });
});

describe("encryption key for the stored grant", () => {
  it("is derived with HKDF and its own label, not the key the session cookies use", () => {
    expect(GRANT_KEY_LABEL).toMatch(/alerts/);
    const plainSha = createHash("sha256").update(SECRET).digest();
    expect(grantKey(SECRET).equals(plainSha)).toBe(false);
    expect(grantKey(SECRET)).toHaveLength(32);
    expect(grantKey(SECRET).equals(grantKey(SECRET))).toBe(true);
  });

  it("a cookie-sealed value is not a valid stored grant, and a stored grant is not a valid cookie", () => {
    const grant = sealGrant({ refreshToken: "RT-x" }, SECRET);
    expect(open(grant, SECRET), "a stored grant opened with the cookie key").toBeNull();
    expect(openGrant(grant, SECRET)).toEqual({ refreshToken: "RT-x" });
    expect(openGrant(seal({ refreshToken: "RT-x" }, SECRET), SECRET), "a cookie value opened as a grant").toBeNull();
  });
});

describe("B4: saving the replacement refresh token", () => {
  const expired = { refreshToken: "RT0", accessToken: "AT0", expiresAt: NOW.getTime() - 1000 };
  function grants(failures: number) {
    const store = {
      calls: 0,
      saved: null as null | { refreshToken: string },
      async readGrant() {
        return { ...expired };
      },
      async writeGrant(_id: string, grant: { refreshToken: string }) {
        store.calls += 1;
        if (store.calls <= failures) throw new Error("store down");
        store.saved = grant;
      },
      async acquireLock() {
        return async () => {};
      },
    };
    return store satisfies GrantStore & Record<string, unknown>;
  }
  const refresh = async (): Promise<TokenSet> => ({ accessToken: "AT1", refreshToken: "RT1", expiresAt: NOW.getTime() + 3_600_000, scope: "posts:read" });

  it("retries a transient store failure: the old token is already spent, so losing the new one ends the grant", async () => {
    const g = grants(2);
    expect(await getAccessToken({ grants: g, refresh, now: () => NOW, sleep: async () => {} }, OWNER_ID)).toBe("AT1");
    expect(g.calls).toBe(3);
    expect(g.saved).toEqual(expect.objectContaining({ refreshToken: "RT1" }));
  });

  it("gives up after three attempts and says the old token is spent", async () => {
    const g = grants(10);
    await expect(getAccessToken({ grants: g, refresh, now: () => NOW, sleep: async () => {} }, OWNER_ID)).rejects.toThrow(/old one is spent/);
    expect(g.calls).toBe(3);
  });
});

describe("B5: the alert triggers on the post's priority label, not on finding severity", () => {
  it("includes the paused-queue post: its card is High but its only finding is Info", async () => {
    const report = await reportInWindow();
    const card = report.cards.find((item) => item.id === "post_fb_paused")!;
    expect(card.priority).toBe("high");
    const items = selectAlertItems(report, { id: OWNER_ID }, { now: NOW, horizonEnd: horizonFor(CONFIG, NOW), appUrl: CONFIG.appUrl });
    const paused = items.filter((item) => item.postId === "post_fb_paused");
    expect(paused, "a post PostGuard labels High is missing from the alert").toHaveLength(1);
    expect(paused[0]!.channelName).toBe("Northwind Journal");
    expect(`${paused[0]!.title} ${paused[0]!.detail}`).toMatch(/paused/i);
  });

  it("every Blocker/High card in the window is in the email, and a post is never listed twice", async () => {
    const report = await reportInWindow();
    const wanted = report.cards.filter((card) => card.priority === "blocker" || card.priority === "high").map((card) => card.id).sort();
    const items = selectAlertItems(report, { id: OWNER_ID }, { now: NOW, horizonEnd: horizonFor(CONFIG, NOW), appUrl: CONFIG.appUrl });
    expect([...new Set(items.map((item) => item.postId))].sort()).toEqual(wanted);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
  });

  it("sends nothing when no card is Blocker/High", async () => {
    const report = await reportInWindow();
    const calm = { ...report, findings: [], cards: report.cards.map((card) => ({ ...card, priority: "low" as const })) };
    const h = harness({ report: calm });
    await h.ready();
    const result = await runAlerts(h.deps);
    expect(result).toMatchObject({ status: "ok", sent: 0 });
    expect(h.sent).toHaveLength(0);
  });
});

describe("B6: an incomplete scan is disclosed", () => {
  it("says in the email (html and text) that the scan was incomplete", async () => {
    const h = harness({ report: await reportInWindow([PARTIAL, "Drafts are hidden."]) });
    await h.ready();
    await runAlerts(h.deps);
    const { message } = h.sent[0]!;
    expect(message.html).toContain(PARTIAL);
    expect(message.html).toMatch(/incomplete/i);
    expect(message.text).toContain(PARTIAL);
    expect(message.html, "informational notes are not warnings").not.toContain("Drafts are hidden");
  });

  it("adds no notice when the scan was complete", async () => {
    const h = harness({ report: await reportInWindow(["Drafts are hidden. Turn on Include drafts to check a post before it is scheduled."]) });
    await h.ready();
    await runAlerts(h.deps);
    expect(h.sent[0]!.message.html).not.toMatch(/incomplete/i);
  });
});

describe("B7: Resend Idempotency-Key", () => {
  it("is sent to Resend, identical for the same alert, and different when a new problem appears", async () => {
    const report = await reportInWindow();
    const keys: string[] = [];
    for (const fewer of [false, true, false]) {
      const h = harness({ report: fewer ? { ...report, cards: report.cards.slice(0, 3) } : report });
      await h.ready();
      await runAlerts(h.deps);
      keys.push(h.sent[0]!.idempotencyKey);
    }
    expect(keys[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(keys[0]).toBe(keys[2]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("a failed send releases the claims and the retry reuses the same key", async () => {
    const report = await reportInWindow();
    const seen: string[] = [];
    let fail = true;
    const mailer: Mailer = {
      async send(_message, { idempotencyKey }) {
        seen.push(idempotencyKey);
        if (fail) throw new Error("provider down");
        return { id: "m" };
      },
    };
    const h = harness({ report, mailer });
    await h.ready();
    expect((await runAlerts(h.deps)).status).toBe("failed");
    fail = false;
    expect(await runAlerts(h.deps)).toMatchObject({ status: "ok", sent: 1 });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(await runAlerts(h.deps)).toMatchObject({ sent: 0 });
  });

  it("the Resend client puts the key in the Idempotency-Key header", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "e1" })));
    await new ResendMailer({ apiKey: "re_x", from: "a@b.c" }, fetchImpl as unknown as typeof fetch).send(
      { to: "me@example.test", subject: "s", text: "t", html: "<p>t</p>", headers: {} },
      { idempotencyKey: "k".repeat(64) },
    );
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe("k".repeat(64));
  });
});

describe("B8: a live run that cannot deliver email is a failure, not a green no-op", () => {
  const quiet = async () => {
    const report = await reportInWindow();
    return { ...report, findings: [], cards: report.cards.map((card) => ({ ...card, priority: "low" as const })) };
  };

  it("fails (503 from the route) when the email provider key is missing, even on a quiet day", async () => {
    const mailer = new ResendMailer({ apiKey: "", from: "a@b.c" });
    const h = harness({ report: await quiet(), mailer });
    await h.ready();
    const secret = "s".repeat(20);
    const response = await handleCron(new Request("https://postguard.test/api/cron/alerts", { headers: { authorization: `Bearer ${secret}` } }), { ...h.deps, env: { CRON_SECRET: secret } });
    expect(response.status).toBe(503);
  });

  it("fails when there is no recipient address", async () => {
    const h = harness({ report: await reportInWindow(), email: "" });
    await h.ready();
    expect((await runAlerts(h.deps)).status).toBe("failed");
    expect(h.sent).toHaveLength(0);
  });

  it("a dry run still works without email configuration", async () => {
    const mailer = new ResendMailer({ apiKey: "", from: "a@b.c" });
    const h = harness({ report: await reportInWindow(), mailer });
    await h.ready();
    const result = await runAlerts(h.deps, { dryRun: true });
    expect(result.status).toBe("ok");
    expect(result.previews!.length).toBeGreaterThan(0);
  });

  it("nothing to deliver and nobody subscribed is fine", async () => {
    const mailer = new ResendMailer({ apiKey: "", from: "a@b.c" });
    const h = harness({ report: await quiet(), mailer, withSubscriber: false });
    expect((await runAlerts(h.deps)).status).toBe("ok");
  });
});

describe("B9: copy", () => {
  it("/demo/alert does not invite visitors to set alerts up on their own account", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/app/demo/alert/page.tsx", "utf8");
    expect(source).not.toMatch(/set (this|it) up for your own/i);
    expect(source).not.toContain('href="/alerts/setup"');
    expect(source).toMatch(/only the owner/i);
  });

  it("the privacy page does not claim that nothing is stored on the server without naming the alert exception", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/app/privacy/page.tsx", "utf8").replace(/\s+/g, " ");
    expect(source).toMatch(/only the owner of a deployment can turn them on/);
    expect(source).toMatch(/refresh token on the server/);
    expect(source).not.toMatch(/Results are not written to a database/);
  });

  it("never claims hourly checks anywhere in the alert copy", async () => {
    const fs = await import("node:fs");
    for (const file of ["src/app/privacy/page.tsx", "src/app/demo/alert/page.tsx", "src/app/alerts/setup/page.tsx", "src/alerts/message.ts", "README.md", ".env.example"]) {
      let text = fs.readFileSync(file, "utf8");
      if (file === "README.md") text = text.slice(text.indexOf("/api/cron/alerts") - 400, text.indexOf("## Tests")); // the alerts section; the alt-text rate cap is unrelated
      expect(text, file).not.toMatch(/hourly|every hour|each hour|every 60 minutes/i);
    }
  });
});




describe("B1: overlapping runs", () => {
  it("a run that finds the run lock taken answers 'skipped-locked' (200 from the route) and touches neither Buffer nor email", async () => {
    const h = harness({ report: await reportInWindow() });
    await h.ready();
    const scan = vi.spyOn(h.deps.reader, "scan");
    const release = await h.store.acquireLock("alerts-run", 60_000);
    expect(release).not.toBeNull();
    const result = await runAlerts(h.deps);
    expect(result.status).toBe("skipped-locked");
    expect(scan).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(0);
    await release!();
    expect(await runAlerts(h.deps)).toMatchObject({ status: "ok", sent: 1 });
  });
});
