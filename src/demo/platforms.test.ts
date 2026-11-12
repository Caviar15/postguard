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

  it("shows a shipped picture for every post that has media, and leaves the no-video post empty", async () => {
    const all = await buildDemoReport(NOW, 7, false, "all");
    expect(all.headline).toBe("Next 7 days: 3 dead links, 1 duplicate, 2 missing alt text, 1 paused channel, 8 other risks.");
    const dye = all.cards.find((card) => card.id === "post_ig_comments");
    expect(dye?.media).toEqual([{ src: "/demo/dye.jpg", alt: "", kind: "image" }]);
    expect(dye?.preview?.src).toBe("/demo/dye.jpg");
    const signed = all.cards.find((card) => card.id === "post_pin_signed");
    expect(signed?.media[0]?.src).toBe("/demo/palette.jpg");
    expect(all.findings.some((finding) => finding.postId === "post_pin_signed" && finding.detail.includes("X-Amz-Signature"))).toBe(true);

    const instagram = await buildDemoReport(NOW, 7, false, "instagram");
    const alt = instagram.cards.find((card) => card.id === "ig_alt");
    const ready = instagram.cards.find((card) => card.id === "ig_ready");
    expect(alt?.media).toEqual([{ src: "/demo/ig-square.jpg", alt: "", kind: "image" }]);
    expect(ready?.media.map((thumb) => thumb.alt)).toEqual([
      "Folded walnut-dyed linen on a studio table",
      "Close view of the walnut dye along the hem",
    ]);
    expect(instagram.cards.find((card) => card.id === "ig_dead")?.media).toEqual([]);

    const tiktok = await buildDemoReport(NOW, 7, false, "tiktok");
    expect(tiktok.cards.find((card) => card.id === "tt_novideo")?.media).toEqual([]);
    expect(tiktok.cards.find((card) => card.id === "tt_ready")?.media).toEqual([
      { src: "/demo/tiktok-ready.jpg", alt: "", kind: "video" },
    ]);
    expect(tiktok.headline).toContain("1 dead link");

    const x = await buildDemoReport(NOW, 7, false, "x");
    expect(x.cards.find((card) => card.id === "x_ready")?.media[0]).toEqual({
      src: "/demo/x-ready.jpg",
      alt: "Linen shirts on a rack in the studio",
      kind: "image",
    });
    expect(x.cards.filter((card) => card.id !== "x_ready").every((card) => card.media.length === 0)).toBe(true);

    const linkedin = await buildDemoReport(NOW, 7, false, "linkedin");
    expect(linkedin.cards.find((card) => card.id === "li_alt")?.media).toEqual([
      { src: "/demo/li-desk.jpg", alt: "", kind: "image" },
    ]);

    const facebook = await buildDemoReport(NOW, 7, false, "facebook");
    expect(facebook.cards.find((card) => card.id === "fb_weak")?.media[0]?.alt).toBe("image");
    expect(facebook.cards.find((card) => card.id === "fb_alt")?.media[0]?.alt).toBe("");
    expect(facebook.cards.find((card) => card.id === "fb_ready")?.media).toEqual([]);
  });
});
