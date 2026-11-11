import { describe, expect, it } from "vitest";
import { makeChannel, makePost } from "@/test/factory";
import { cropFrame, ratioBand } from "@/rules/crop";
import { channelReadiness, channelScore, postReadiness, riskHeadline } from "./readiness";

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

describe("readiness", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");

  it("fails a post with a blocker and marks a paused channel as needing attention", () => {
    const channel = makeChannel({ isQueuePaused: true });
    const post = makePost();
    expect(postReadiness(post, [{ ...finding("blocker"), postId: post.id }], channel)).toBe("fail");
    expect(postReadiness(post, [], channel)).toBe("attention");
    expect(channelScore([])).toBe(100);
    expect(channelReadiness(100, ["attention"])).toBe("attention");
  });

  it("names an overdue risky post and a clear window", () => {
    expect(riskHeadline([{ dueAt: "2026-11-10T09:00:00.000Z", readiness: "fail" }], now)).toBe("A risky post is already overdue.");
    expect(riskHeadline([{ dueAt: "2026-11-12T12:00:00.000Z", readiness: "ready" }], now)).toBe("Nothing risky is scheduled in this window.");
    expect(riskHeadline([{ dueAt: "2026-11-11T03:00:00.000Z", readiness: "attention" }], now)).toBe("Next risky post in 15 hours.");
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
