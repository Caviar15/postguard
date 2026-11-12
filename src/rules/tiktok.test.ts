import { describe, expect, it } from "vitest";
import { makeChannel, makePost } from "@/test/factory";
import { runRules } from "./engine";

const NOW = new Date("2026-11-12T12:00:00.000Z");

function run(post: ReturnType<typeof makePost>) {
  return runRules({
    posts: [post],
    channels: [makeChannel({ service: post.service })],
    linkResults: new Map(),
    now: NOW,
  }).filter((finding) => finding.ruleId === "tiktok-video");
}

describe("tiktok video", () => {
  it("flags a TikTok post with no video and says the check is best-effort", () => {
    const findings = run(makePost({ service: "tiktok", text: "A clip from the dye room." }));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.detail).toMatch(/best-effort/i);
    expect(findings[0]?.detail).toMatch(/9:16/);
  });

  it("leaves a TikTok post that has a video, and ignores other networks", () => {
    const video = { type: "video" as const, source: "https://cdn.example/a.mp4", thumbnail: null, mimeType: "video/mp4", altText: null, width: 1080, height: 1920 };
    expect(run(makePost({ service: "tiktok", assets: [video] }))).toHaveLength(0);
    expect(run(makePost({ service: "instagram", text: "A still." }))).toHaveLength(0);
  });
});
