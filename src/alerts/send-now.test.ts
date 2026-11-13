// DEMO-ONLY: remove after Buffer Commit
import { afterEach, describe, expect, it } from "vitest";
import { POST as sendNowPOST } from "@/app/api/alerts/send-now/route";
import { BufferAuthError } from "@/buffer/client";
import type { Finding, PostCard, ScanReport, Severity } from "@/domain/types";
import { LiveQueueReader } from "./reader";
import { FakeRedis } from "./fake-redis";
import { RedisAlertStore } from "./redis";
import { selectAlertItems, horizonFor } from "./select";
import {
  DEMO_WINDOW_DAYS,
  SEND_NOW_LOCK,
  handleSendNow,
  renderTestMessage,
  selectDemoAlertItems,
} from "./send-now";
import type { Mailer, QueueReader, RunDeps, Subscriber } from "./types";

const NOW = new Date("2026-11-13T08:30:00Z");
const SECRET = "send-now-session-secret-xxxxxxxxxxxx";
const CRON = "cron-secret-for-send-now-tests";
const ORIGIN = "https://postguard.test";
const silent = { info() {}, warn() {}, error() {} };

function card(overrides: Partial<PostCard> = {}): PostCard {
  return {
    id: "p1",
    channelId: "c1",
    channelName: "Northwind",
    service: "linkedin",
    status: "scheduled",
    dueAt: "2026-11-15T15:00:00.000Z",
    timeZone: "Europe/Amsterdam",
    excerpt: "A caption with a problem",
    priority: "high",
    risk: 18,
    fixUrl: "https://publish.buffer.com/channels/c1?post=p1",
    needsAlt: false,
    preview: null,
    media: [],
    mediaExtra: 0,
    ...overrides,
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    ruleId: "dead-link",
    severity: "high",
    title: "A link will not open",
    detail: "The page answered 404.",
    postId: "p1",
    channelId: "c1",
    channelName: "Northwind",
    service: "linkedin",
    dueAt: "2026-11-15T15:00:00.000Z",
    excerpt: "A caption with a problem",
    fixUrl: "https://publish.buffer.com/channels/c1?post=p1",
    advisory: false,
    ...overrides,
  };
}

function report(cards: PostCard[], findings: Finding[]): ScanReport {
  return {
    scannedAt: NOW.toISOString(),
    windowDays: DEMO_WINDOW_DAYS,
    mode: "live",
    includeDrafts: true,
    organization: { id: "org1", name: "Northwind" },
    postsScanned: cards.length,
    riskHeadline: "Test",
    cards,
    channels: [],
    findings,
    totals: { blocker: 0, high: 0, medium: 0, low: 0, info: 0 },
    headline: "Test",
    suggestions: [],
    quota: { label: "", windows: [] },
    requestsUsed: 0,
    cached: false,
    notes: [],
  };
}

function form(code: string): Request {
  return new Request(`${ORIGIN}/api/alerts/send-now`, {
    method: "POST",
    body: new URLSearchParams({ code }),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });
}

function locationOf(res: Response): URL {
  return new URL(res.headers.get("location")!, ORIGIN);
}

function keysOf(redis: FakeRedis, kind: "claim" | "last" | "lock") {
  const prefix = `pg:alerts:${kind}`;
  return redis.commands.filter((args) => String(args[1] ?? "").startsWith(prefix));
}

function harness(options: { report?: ScanReport; mailer?: Mailer; email?: string; configured?: boolean; withSubscriber?: boolean } = {}) {
  let clock = NOW.getTime();
  const redis = new FakeRedis(() => clock);
  const store = new RedisAlertStore(redis, SECRET, () => ({ email: options.email ?? "owner@example.test", timeZone: "Europe/Amsterdam" }));
  const sent: Array<{ message: { subject: string; text: string; html: string; to: string }; idempotencyKey: string }> = [];
  const mailer: Mailer =
    options.mailer ??
    {
      configured: () => (options.configured ?? true),
      async send(message, { idempotencyKey }) {
        sent.push({ message, idempotencyKey });
        return { id: "m1" };
      },
    };
  const windows: Array<{ from: Date; to: Date; includeDrafts?: boolean }> = [];
  const reader: QueueReader = {
    scan: async (_subscriber, window) => {
      windows.push(window);
      return options.report ?? report([], []);
    },
  };
  const env: Record<string, string | undefined> = {
    CRON_SECRET: CRON,
    KV_REST_API_URL: "https://redis.test",
    KV_REST_API_TOKEN: "redis-token",
    SESSION_SECRET: SECRET,
    ALERT_EMAIL_TO: options.email ?? "owner@example.test",
    RESEND_API_KEY: "re_test",
  };
  const deps: RunDeps = {
    store,
    mailer,
    reader,
    now: () => new Date(clock),
    log: silent,
    config: { appUrl: ORIGIN, cadenceHours: 24, jitterHours: 1, leadHours: 2 },
    sleep: async () => {},
    env,
  };
  return {
    redis,
    store,
    sent,
    windows,
    deps,
    advance: (ms: number) => {
      clock += ms;
    },
    ready: () =>
      options.withSubscriber === false
        ? Promise.resolve()
        : store.enable({ accessToken: "AT", refreshToken: "RT", expiresAt: clock + 3_600_000 }, new Date(clock)),
  };
}

const DRAFT_AND_FAR = report(
  [
    card({ id: "draft-1", status: "draft", dueAt: null, priority: "blocker", excerpt: "Draft with a missing picture" }),
    card({ id: "far-1", status: "scheduled", dueAt: "2026-11-16T12:00:00.000Z", priority: "high", excerpt: "Scheduled well after the daily window" }),
  ],
  [
    finding({ id: "fd", postId: "draft-1", severity: "blocker", title: "This post has no picture", detail: "Instagram needs a picture.", dueAt: null, excerpt: "Draft with a missing picture" }),
    finding({ id: "ff", postId: "far-1", severity: "high", title: "A link will not open", detail: "The page answered 404.", dueAt: "2026-11-16T12:00:00.000Z", excerpt: "Scheduled well after the daily window" }),
  ],
);

describe("POST /api/alerts/send-now", () => {
  const prior = { CRON_SECRET: process.env.CRON_SECRET };
  afterEach(() => {
    if (prior.CRON_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prior.CRON_SECRET;
  });

  it("a wrong or empty code redirects back and does not reveal config", async () => {
    process.env.CRON_SECRET = CRON;
    for (const code of ["", "wrong-code-wrong-code", CRON.slice(0, 20), `${CRON}x`]) {
      const res = await sendNowPOST(form(code));
      expect(res.status).toBe(303);
      const url = locationOf(res);
      expect(url.pathname).toBe("/alerts/setup");
      expect(url.searchParams.get("problem")).toBe("code");
      expect(url.href).not.toContain(CRON);
    }
  });

  it("with no CRON_SECRET configured no code works", async () => {
    delete process.env.CRON_SECRET;
    const res = await sendNowPOST(form("undefined".repeat(3)));
    expect(locationOf(res).searchParams.get("problem")).toBe("code");
  });
});

describe("handleSendNow", () => {
  it("includes drafts and posts outside the 27-hour horizon, and writes no claims", async () => {
    const h = harness({ report: DRAFT_AND_FAR });
    await h.ready();
    const dailyItems = selectAlertItems(DRAFT_AND_FAR, { id: "owner" }, { now: NOW, horizonEnd: horizonFor(h.deps.config, NOW), appUrl: ORIGIN });
    expect(dailyItems, "the daily selector would skip the undated draft and the post 3 days out").toHaveLength(0);

    const res = await handleSendNow(form(CRON), h.deps);
    expect(locationOf(res).search).toBe("?sent=1&issues=2");
    expect(h.sent).toHaveLength(1);
    expect(h.windows[0]).toMatchObject({ includeDrafts: true });
    expect((h.windows[0]!.to.getTime() - h.windows[0]!.from.getTime()) / 86_400_000).toBe(DEMO_WINDOW_DAYS);
    const { subject, text } = h.sent[0]!.message;
    expect(subject.startsWith("[Test] ")).toBe(true);
    expect(text).toMatch(/sent on demand from the setup page/i);
    expect(text).toMatch(/includes drafts/i);
    expect(text).toContain("Draft, no publish time");
    expect(text).toContain("This post has no picture");
    expect(text).toContain("A link will not open");
    expect(keysOf(h.redis, "claim")).toHaveLength(0);
    expect(keysOf(h.redis, "last")).toHaveLength(0);
    const lockNames = keysOf(h.redis, "lock").map((args) => String(args[1]));
    expect(lockNames).toEqual(["pg:alerts:lock:alerts-send-now"]);
  });

  it("refuses a second press within 60 seconds and does not send again", async () => {
    const h = harness({ report: DRAFT_AND_FAR });
    await h.ready();
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).search).toBe("?sent=1&issues=2");
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).searchParams.get("problem")).toBe("test-wait");
    expect(h.sent).toHaveLength(1);
  });

  it("a new press after the rate-limit window uses a new idempotency key", async () => {
    const h = harness({ report: DRAFT_AND_FAR });
    await h.ready();
    await handleSendNow(form(CRON), h.deps);
    h.advance(60_001);
    await handleSendNow(form(CRON), h.deps);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[0]!.idempotencyKey).not.toBe(h.sent[1]!.idempotencyKey);
  });

  it("does not take or wait on the daily cron lock", async () => {
    const h = harness({ report: DRAFT_AND_FAR });
    await h.ready();
    const cronRelease = await h.store.acquireLock("alerts-run", 10 * 60_000);
    expect(cronRelease).not.toBeNull();
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).search).toBe("?sent=1&issues=2");
    expect(h.sent).toHaveLength(1);
    const lockKeys = keysOf(h.redis, "lock").map((args) => String(args[1]));
    expect(lockKeys).toContain("pg:alerts:lock:alerts-run");
    expect(lockKeys).toContain("pg:alerts:lock:alerts-send-now");
    await cronRelease!();
  });

  it("a mail failure redirects with an error and still writes no claims", async () => {
    const h = harness({
      report: DRAFT_AND_FAR,
      mailer: {
        configured: () => true,
        async send() {
          throw new Error("provider down");
        },
      },
    });
    await h.ready();
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).searchParams.get("problem")).toBe("test-mail");
    expect(keysOf(h.redis, "claim")).toHaveLength(0);
    expect(keysOf(h.redis, "last")).toHaveLength(0);
  });

  it("a wrong code does not take the rate-limit lock or read the queue", async () => {
    const h = harness({ report: DRAFT_AND_FAR });
    await h.ready();
    const res = await handleSendNow(form("nope-nope-nope-nope-nope"), h.deps);
    expect(locationOf(res).searchParams.get("problem")).toBe("code");
    expect(h.windows).toHaveLength(0);
    expect(h.sent).toHaveLength(0);
    expect(keysOf(h.redis, "lock")).toHaveLength(0);
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).search).toBe("?sent=1&issues=2");
  });

  it("with no saved grant it does not send", async () => {
    const h = harness({ report: DRAFT_AND_FAR, withSubscriber: false });
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).searchParams.get("problem")).toBe("test-grant");
    expect(h.sent).toHaveLength(0);
    expect(h.windows).toHaveLength(0);
  });

  it("a Buffer auth failure is reported as a missing grant", async () => {
    const h = harness({ report: DRAFT_AND_FAR });
    await h.ready();
    h.deps.reader.scan = async () => {
      throw new BufferAuthError("Alerts are not connected to Buffer. Turn them on again at /alerts/setup.");
    };
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).searchParams.get("problem")).toBe("test-grant");
    expect(h.sent).toHaveLength(0);
    expect(keysOf(h.redis, "claim")).toHaveLength(0);
  });

  it("a queue read failure is reported without sending", async () => {
    const h = harness({ report: DRAFT_AND_FAR });
    await h.ready();
    h.deps.reader.scan = async () => {
      throw new Error("Buffer did not answer");
    };
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).searchParams.get("problem")).toBe("test-read");
    expect(h.sent).toHaveLength(0);
  });

  it("sends nothing when the queue has no issues, including drafts", async () => {
    const quiet = report([card({ priority: "ready", status: "draft", dueAt: null })], []);
    const h = harness({ report: quiet });
    await h.ready();
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).searchParams.get("problem")).toBe("test-empty");
    expect(h.sent).toHaveLength(0);
    expect(h.windows[0]?.includeDrafts).toBe(true);
  });

  it("falls back to every severity when there is no Blocker or High issue", async () => {
    const mild = report(
      [card({ id: "m1", status: "draft", dueAt: null, priority: "medium", excerpt: "A long caption" })],
      [finding({ id: "fm", postId: "m1", severity: "medium" as Severity, title: "This caption is long", detail: "It may be cut off.", dueAt: null, excerpt: "A long caption" })],
    );
    const h = harness({ report: mild });
    await h.ready();
    expect(locationOf(await handleSendNow(form(CRON), h.deps)).search).toBe("?sent=1&issues=1");
    expect(h.sent[0]!.message.text).toContain("[Medium]");
    expect(h.sent[0]!.message.text).toMatch(/every severity/i);
    expect(h.sent[0]!.message.subject.startsWith("[Test] ")).toBe(true);
  });
});

describe("selectDemoAlertItems and renderTestMessage", () => {
  const owner: Pick<Subscriber, "id"> = { id: "owner" };

  it("keeps an undated draft and a post past the daily horizon", () => {
    const { items, widened } = selectDemoAlertItems(DRAFT_AND_FAR, owner, ORIGIN);
    expect(widened).toBe(false);
    expect(items.map((item) => item.postId).sort()).toEqual(["draft-1", "far-1"]);
    expect(items.find((item) => item.postId === "draft-1")?.dueAt).toBeNull();
  });

  it("labels the test email as on-demand and as including drafts", () => {
    const { items, widened } = selectDemoAlertItems(DRAFT_AND_FAR, owner, ORIGIN);
    const subscriber: Subscriber = {
      id: "owner",
      email: "owner@example.test",
      organizationId: "",
      timeZone: "Europe/Amsterdam",
      unsubscribed: false,
      unsubscribeToken: "t".repeat(30),
      credentials: { accessToken: "", refreshToken: null, expiresAt: 0 },
    };
    const message = renderTestMessage(items, subscriber, { now: NOW, appUrl: ORIGIN, report: DRAFT_AND_FAR, widened });
    expect(message.subject).toBe("[Test] PostGuard: 2 posts need attention");
    expect(message.text).toContain("This was sent on demand from the setup page and includes drafts.");
    expect(message.html).toContain("PostGuard test alert");
  });
});

describe("LiveQueueReader passes includeDrafts through", () => {
  it("asks scanLive for drafts when the window says so", async () => {
    const seen: Array<{ includeDrafts?: boolean; windowDays: number }> = [];
    const reader = new LiveQueueReader(async () => "tok", async (input) => {
      seen.push({ includeDrafts: input.includeDrafts, windowDays: input.windowDays });
      return report([], []);
    });
    const subscriber: Subscriber = {
      id: "owner",
      email: "o@x.test",
      organizationId: "org1",
      timeZone: null,
      unsubscribed: false,
      unsubscribeToken: "t".repeat(30),
      credentials: { accessToken: "tok", refreshToken: "rt", expiresAt: 0 },
    };
    await reader.scan(subscriber, { from: NOW, to: new Date(NOW.getTime() + DEMO_WINDOW_DAYS * 86_400_000), includeDrafts: true });
    expect(seen[0]).toEqual({ includeDrafts: true, windowDays: DEMO_WINDOW_DAYS });
  });
});
