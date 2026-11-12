import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

/**
 * TikTok posts are videos, usually vertical. Best-effort: Buffer does not
 * publish this as a rule, so a missing video is inferred from the network.
 * A video that is not 9:16 is handled by the existing crop check.
 */
export function tiktokVideo(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    if (post.service !== "tiktok") continue;
    if (post.assets.some((asset) => asset.type === "video")) continue;
    findings.push(
      makeFinding(ctx, {
        ruleId: "tiktok-video",
        severity: "high",
        title: "TikTok post has no video",
        detail: "TikTok posts are videos, usually vertical 9:16. This one has no video attached. Best-effort: Buffer does not publish a TikTok media rule, so this is inferred from the network.",
        post,
        channelId: post.channelId,
        key: "missing-video",
      }),
    );
  }
  return findings;
}
