import { describe, expect, it } from "vitest";
import { makeChannel, makePost } from "@/test/factory";
import { cropFrame, ratioBand } from "@/rules/crop";
import { channelPriority, channelScore, compareByPriority, compareByTime, countPriorities, postPriority, riskHeadline, selectCards } from "./readiness";

describe("crop preview geometry", () => {
  it("hatches the top and bottom of a portrait image on an Instagram feed post", () => {
    const band = ratioBand("instagram", "post", false);
    const frame = cropFrame(1080, 1920, band);
    expect(frame?.cropped).toBe(true);
    expect(frame?.top).toBeGreaterThan(0.1);
    expect(frame?.left).toBe(0);
    expect(cropFrame(1080, 1350, band)?.cropped).toBe(false);
  });
});

describe("priority", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");

  it("uses the highest finding, treats info as Ready, and keeps Low off Ready", () => {
    const post = makePost();
    const channel = makeChannel();
    expect(postPriority(post, [{ ...finding("low"), postId: post.id }], channel)).toBe("low");
    expect(postPriority(post, [{ ...finding("info"), postId: post.id }], channel)).toBe("ready");
    expect(postPriority(post, [], channel)).toBe("ready");
    expect(postPriority(post, [{ ...finding("low"), postId: post.id }, { ...finding("medium"), postId: post.id }], channel)).toBe("medium");
    expect(postPriority(post, [{ ...finding("blocker"), postId: post.id }], makeChannel({ isQueuePaused: true }))).toBe("blocker");
  });

  it("marks a disconnected or locked channel Blocker and a paused queue High", () => {
    const post = makePost();
    expect(postPriority(post, [], makeChannel({ isDisconnected: true }))).toBe("blocker");
    expect(postPriority(post, [], makeChannel({ isLocked: true }))).toBe("blocker");
    expect(postPriority(post, [{ ...finding("low"), postId: post.id }], makeChannel({ isQueuePaused: true }))).toBe("high");
    expect(channelPriority([], makeChannel({ isQueuePaused: true }))).toBe("high");
    expect(channelPriority(["low", "ready"], makeChannel())).toBe("low");
    expect(channelPriority(["ready"], makeChannel({ isLocked: true }))).toBe("blocker");
    expect(channelScore([])).toBe(100);
    expect(channelScore([{ ...finding("low"), postId: "p1" }])).toBe(97);
  });

  it("counts Blocker, High, and Medium as risky, and not Low", () => {
    expect(riskHeadline([{ dueAt: "2026-11-10T09:00:00.000Z", priority: "blocker" }], now)).toBe("A risky post is already overdue.");
    expect(riskHeadline([{ dueAt: "2026-11-12T12:00:00.000Z", priority: "ready" }], now)).toBe("Nothing risky is scheduled in this window.");
    expect(riskHeadline([{ dueAt: "2026-11-12T12:00:00.000Z", priority: "low" }], now)).toBe("Nothing risky is scheduled in this window.");
    expect(riskHeadline([{ dueAt: "2026-11-11T03:00:00.000Z", priority: "high" }], now)).toBe("Next risky post in 15 hours.");
    expect(riskHeadline([{ dueAt: "2026-11-11T03:00:00.000Z", priority: "medium" }], now)).toBe("Next risky post in 15 hours.");
  });

  it("sorts by priority, then soonest time, with undated posts last", () => {
    const cards = [
      { id: "ready-soon", priority: "ready" as const, dueAt: "2026-11-12T08:00:00.000Z" },
      { id: "low-soon", priority: "low" as const, dueAt: "2026-11-12T09:00:00.000Z" },
      { id: "high-late", priority: "high" as const, dueAt: "2026-11-13T09:00:00.000Z" },
      { id: "high-soon", priority: "high" as const, dueAt: "2026-11-12T10:00:00.000Z" },
      { id: "blocker-none", priority: "blocker" as const, dueAt: null },
      { id: "blocker-soon", priority: "blocker" as const, dueAt: "2026-11-12T18:00:00.000Z" },
    ];
    expect([...cards].sort(compareByPriority).map((card) => card.id)).toEqual([
      "blocker-soon",
      "blocker-none",
      "high-soon",
      "high-late",
      "low-soon",
      "ready-soon",
    ]);
    expect([...cards].sort(compareByTime).map((card) => card.id)).toEqual([
      "ready-soon",
      "low-soon",
      "high-soon",
      "blocker-soon",
      "high-late",
      "blocker-none",
    ]);
  });

  it("counts posts by the same priority label the card shows, including a zero", () => {
    const cards = [
      { priority: "blocker" as const },
      { priority: "blocker" as const },
      { priority: "high" as const },
      { priority: "ready" as const },
    ];
    expect(countPriorities(cards)).toEqual({ blocker: 2, high: 1, medium: 0, low: 0, ready: 1 });
  });

  it("filters to one label and then sorts", () => {
    const cards = [
      { id: "ready", priority: "ready" as const, dueAt: "2026-11-12T08:00:00.000Z" },
      { id: "high-late", priority: "high" as const, dueAt: "2026-11-13T09:00:00.000Z" },
      { id: "high-soon", priority: "high" as const, dueAt: "2026-11-12T10:00:00.000Z" },
      { id: "low", priority: "low" as const, dueAt: "2026-11-12T09:00:00.000Z" },
    ];
    expect(selectCards(cards, "ready", "priority").map((card) => card.id)).toEqual(["ready"]);
    expect(selectCards(cards, "high", "time").map((card) => card.id)).toEqual(["high-soon", "high-late"]);
    expect(selectCards(cards, "all", "priority").map((card) => card.id)).toEqual(["high-soon", "high-late", "low", "ready"]);
  });
});

function finding(severity: "blocker" | "high" | "medium" | "low" | "info") {
  return {
    id: "f",
    ruleId: "x",
    severity,
    title: "t",
    detail: "d",
    postId: "p1",
    channelId: "c1",
    channelName: "Northwind",
    service: "linkedin",
    dueAt: null,
    excerpt: null,
    fixUrl: "https://publish.buffer.com/channels/c1",
    advisory: false,
  };
}
