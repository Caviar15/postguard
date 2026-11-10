import type { Finding, Post } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

type RatioBand = { min: number; max: number; label: string };

/**
 * Best-effort bands. Buffer's configuration rules do not include aspect
 * ratio, and these ranges move. Findings are marked advisory.
 *
 * Instagram feed 4:5–1.91:1 and story/reel 9:16 follow Meta's media docs:
 * https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 * Pinterest's recommended pin is 2:3:
 * https://help.pinterest.com/en/business/article/pinterest-product-specs
 */
function band(post: Post): RatioBand | null {
  const kind = (post.postType ?? "post").toLowerCase();
  if (post.service === "instagram") {
    if (kind === "story" || kind === "reel") return { min: 0.5625, max: 0.5625, label: "9:16" };
    return { min: 0.8, max: 1.91, label: "4:5 to 1.91:1" };
  }
  if (post.service === "tiktok" && post.assets.some((asset) => asset.type === "video")) {
    return { min: 0.5625, max: 0.5625, label: "9:16" };
  }
  if (post.service === "pinterest") return { min: 0.5, max: 0.8, label: "around 2:3" };
  return null;
}

const TOLERANCE = 0.02;

export function aspectRatio(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    const expected = band(post);
    if (!expected) continue;
    post.assets.forEach((asset, index) => {
      if (asset.type !== "image" && asset.type !== "video") return;
      if (!asset.width || !asset.height) return;
      const ratio = asset.width / asset.height;
      const min = expected.min * (1 - TOLERANCE);
      const max = expected.max * (1 + TOLERANCE);
      if (ratio >= min && ratio <= max) return;
      findings.push(
        makeFinding(ctx, {
          ruleId: "aspect-ratio",
          severity: "high",
          title: "Image is outside the usual crop",
          detail: `${asset.width}×${asset.height} is ${ratio.toFixed(2)}:1. ${post.service} ${post.postType ?? "post"} is usually ${expected.label}. Best-effort: Buffer does not publish an aspect-ratio rule, and a zero dimension from the API is ignored.`,
          post,
          channelId: post.channelId,
          key: `asset-${index}`,
          advisory: true,
        }),
      );
    });
  }
  return findings;
}
