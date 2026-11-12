import { describe, expect, it } from "vitest";
import { buildDemoReport } from "@/demo/build";
import { makeChannel } from "@/test/factory";
import { channelScore } from "./readiness";

describe("channel score agrees with the High label for a paused queue", () => {
  it("subtracts the High penalty once for a paused queue, on top of finding penalties", () => {
    expect(channelScore([], makeChannel({ isQueuePaused: true }))).toBe(82);
    expect(channelScore([], makeChannel())).toBe(100);
    expect(channelScore([], undefined)).toBe(100);
  });

  it("the demo's paused Journal channel no longer reads 'score 100 · High'", async () => {
    const report = await buildDemoReport(new Date("2026-11-10T12:00:00.000Z"), 7);
    const journal = report.channels.find((channel) => channel.id === "ch_fb");
    expect(journal?.priority).toBe("high");
    expect(journal?.score).toBeLessThan(100);
  });
});
