import { describe, expect, it } from "vitest";
import type { Priority } from "@/domain/types";
import { countPriorities } from "@/domain/readiness";
import { buildDemoReport } from "./build";
import { DEMO_PLATFORMS, parseDemoPlatform } from "./platforms";

const NOW = new Date("2026-11-10T12:00:00.000Z");

describe("demo platform switch", () => {
  it("reads the URL value and treats anything else as the mixed queue", () => {
    expect(parseDemoPlatform("tiktok")).toBe("tiktok");
    expect(parseDemoPlatform("x")).toBe("x");
    expect(parseDemoPlatform("twitter")).toBe("x");
    expect(parseDemoPlatform("nope")).toBe("all");
    expect(parseDemoPlatform(undefined)).toBe("all");
  });

  it("keeps the mixed queue on All", async () => {
    const report = await buildDemoReport(NOW, 7, false, "all");
    expect(report.channels.length).toBeGreaterThan(1);
    expect(report.headline).toContain("3 dead links");
    expect(report.postsScanned).toBeGreaterThan(8);
  });

  for (const platform of DEMO_PLATFORMS.filter((item) => item !== "all")) {
    it(`${platform} is one channel, 5 to 8 posts, and a mix of priorities`, async () => {
      const report = await buildDemoReport(NOW, 7, false, platform);
      expect(report.channels).toHaveLength(1);
      expect(report.postsScanned).toBeGreaterThanOrEqual(5);
      expect(report.postsScanned).toBeLessThanOrEqual(8);
      expect(report.headline.startsWith("Next 7 days:")).toBe(true);
      const counts = countPriorities(report.cards);
      expect(counts.blocker).toBeGreaterThanOrEqual(1);
      expect(counts.high).toBeGreaterThanOrEqual(1);
      expect(counts.medium + counts.low).toBeGreaterThanOrEqual(1);
      expect(counts.ready).toBeGreaterThanOrEqual(1);
      expect(counts.blocker + counts.high + counts.medium + counts.low + counts.ready).toBe(report.postsScanned);
      const priorities = new Set(report.cards.map((card) => card.priority));
      expect(priorities.has("blocker" as Priority)).toBe(true);
    });
  }

  it("shows the platform-specific checks", async () => {
    const instagram = await buildDemoReport(NOW, 7, false, "instagram");
    expect(instagram.findings.some((finding) => finding.ruleId === "hashtags" && finding.severity === "high")).toBe(true);
    const x = await buildDemoReport(NOW, 7, false, "x");
    expect(x.findings.some((finding) => finding.ruleId === "text-length" && finding.severity === "blocker")).toBe(true);
    const linkedin = await buildDemoReport(NOW, 7, false, "linkedin");
    expect(linkedin.findings.some((finding) => finding.ruleId === "text-length" && finding.severity === "blocker")).toBe(true);
    expect(linkedin.findings.some((finding) => finding.ruleId === "needs-approval")).toBe(true);
    expect(linkedin.cards.find((card) => card.id === "li_later")?.priority).toBe("ready");
    const tiktok = await buildDemoReport(NOW, 7, false, "tiktok");
    expect(tiktok.findings.some((finding) => finding.ruleId === "tiktok-video")).toBe(true);
    expect(tiktok.findings.some((finding) => finding.ruleId === "aspect-ratio")).toBe(true);
    expect(tiktok.channels[0]?.service).toBe("tiktok");
  });
});
