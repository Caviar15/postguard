import { describe, expect, it } from "vitest";
import { buildDemoReport } from "@/demo/build";
import type { Finding, PostCard, Severity } from "@/domain/types";
import { buildAlert, collectRisky, escapeHtml, formatWhen } from "./build";

const OPTIONS = { dashboardUrl: "https://postguard.test/dashboard" };

function finding(id: string, severity: Severity, overrides: Partial<Finding> = {}): Finding {
  return {
    id,
    ruleId: `rule-${id}`,
    severity,
    title: `Title ${id}`,
    detail: "detail",
    postId: "p1",
    channelId: "c1",
    channelName: "Northwind",
    service: "linkedin",
    dueAt: "2026-11-16T13:30:00.000Z",
    excerpt: "A caption",
    fixUrl: "https://publish.buffer.com/channels/c1?post=p1",
    advisory: false,
    ...overrides,
  };
}

function card(id: string, overrides: Partial<PostCard> = {}): PostCard {
  return {
    id,
    channelId: "c1",
    channelName: "Northwind",
    service: "linkedin",
    status: "scheduled",
    dueAt: "2026-11-16T13:30:00.000Z",
    timeZone: "Europe/Amsterdam",
    excerpt: "Caption for " + id,
    priority: "blocker",
    risk: 10,
    fixUrl: `https://publish.buffer.com/channels/c1?post=${id}`,
    needsAlt: false,
    preview: null,
    media: [],
    mediaExtra: 0,
    ...overrides,
  };
}

describe("alert builder", () => {
  it("only includes Blocker and High findings", () => {
    const findings = (["blocker", "high", "medium", "low", "info"] as Severity[]).map((severity, index) =>
      finding(String(index), severity, { postId: `p${index}` }),
    );
    const cards = findings.map((item) => card(item.postId!));
    const posts = collectRisky({ findings, cards });
    expect(posts.map((post) => post.key).sort()).toEqual(["p0", "p1"]);
    const alert = buildAlert({ findings, cards }, OPTIONS)!;
    expect(alert.blockers).toBe(1);
    expect(alert.high).toBe(1);
    expect(alert.html).not.toContain("Title 2");
    expect(alert.text).not.toContain("Title 4");
  });

  it("returns null, so nothing is sent, when only Medium and below are found", () => {
    const findings = [finding("a", "medium"), finding("b", "low"), finding("c", "info")];
    expect(buildAlert({ findings, cards: [card("p1")] }, OPTIONS)).toBeNull();
    expect(buildAlert({ findings: [], cards: [] }, OPTIONS)).toBeNull();
  });

  it("groups findings per post and lists blockers before high, then soonest first", () => {
    const findings = [
      finding("a", "high", { postId: "late", dueAt: "2026-11-15T10:00:00.000Z" }),
      finding("b", "blocker", { postId: "later", dueAt: "2026-11-18T10:00:00.000Z" }),
      finding("c", "high", { postId: "later", dueAt: "2026-11-18T10:00:00.000Z" }),
      finding("d", "high", { postId: "early", dueAt: "2026-11-14T10:00:00.000Z" }),
    ];
    const cards = ["late", "later", "early"].map((id) => card(id, { dueAt: findings.find((f) => f.postId === id)!.dueAt }));
    const posts = collectRisky({ findings, cards });
    expect(posts.map((post) => post.key)).toEqual(["later", "early", "late"]);
    expect(posts[0].findings.map((item) => item.severity)).toEqual(["blocker", "high"]);
  });

  it("shows the publish time in Europe/Amsterdam with the caption snippet, channel and Fix in Buffer link", () => {
    expect(formatWhen("2026-07-01T12:00:00.000Z")).toBe("Wed 1 Jul 14:00 · Amsterdam time");
    expect(formatWhen("2026-11-16T13:30:00.000Z")).toContain("14:30");
    const alert = buildAlert({ findings: [finding("a", "blocker")], cards: [card("p1", { excerpt: "x".repeat(400) })] }, OPTIONS)!;
    expect(alert.html).toContain("Fix in Buffer");
    expect(alert.html).toContain('href="https://publish.buffer.com/channels/c1?post=p1"');
    expect(alert.html).toContain("Open PostGuard");
    expect(alert.html).toContain("https://postguard.test/dashboard");
    expect(alert.html).toContain("Northwind");
    expect(alert.text).toContain("Fix in Buffer: https://publish.buffer.com/channels/c1?post=p1");
    expect(alert.posts[0].excerpt!.length).toBeLessThanOrEqual(140);
    expect(alert.subject).toMatch(/1 scheduled post needs attention \(1 blocker\)/);
  });

  it("cuts a caption on a character boundary, never in the middle of a surrogate pair", () => {
    const bold = "𝗦".repeat(300);
    const cut = collectRisky({ findings: [finding("a", "blocker")], cards: [card("p1", { excerpt: bold })] })[0].excerpt!;
    expect(cut).not.toContain("\uFFFD");
    expect(Array.from(cut).length).toBe(140);
    expect(cut.endsWith("…")).toBe(true);
  });

  it("escapes caption and finding text so a post cannot inject HTML", () => {
    const evil = `<img src=x onerror=alert(1)> "q" & 'a'`;
    const alert = buildAlert(
      { findings: [finding("a", "blocker", { title: evil })], cards: [card("p1", { excerpt: evil })] },
      OPTIONS,
    )!;
    expect(alert.html).not.toContain("<img");
    expect(alert.html).toContain(escapeHtml(evil.slice(0, 20)));
  });

  it("groups whole-channel findings under the channel", () => {
    const alert = buildAlert({ findings: [finding("a", "blocker", { postId: null, title: "Channel is disconnected" })], cards: [] }, OPTIONS)!;
    expect(alert.posts[0].whenLabel).toBe("Whole channel");
    expect(alert.posts[0].excerpt).toBeNull();
  });

  it("adds the sample-data banner only when a preview label is given", () => {
    const base = { findings: [finding("a", "blocker")], cards: [card("p1")] };
    expect(buildAlert(base, OPTIONS)!.html).not.toContain("Preview with sample data");
    expect(buildAlert(base, { ...OPTIONS, previewLabel: "Preview with sample data." })!.html).toContain("Preview with sample data");
  });

  it("builds an email from the demo queue and not from lower-priority findings", async () => {
    const report = await buildDemoReport(new Date("2026-11-10T12:00:00.000Z"), 7);
    const alert = buildAlert(report, OPTIONS)!;
    expect(alert).not.toBeNull();
    const expected = report.findings.filter((item) => item.severity === "blocker" || item.severity === "high").length;
    expect(alert.blockers + alert.high).toBe(expected);
  });
});
