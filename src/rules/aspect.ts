import type { Finding } from "@/domain/types";
import { cropForPost, ratioBand } from "./crop";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

export function aspectRatio(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    const band = ratioBand(post.service, post.postType, post.assets.some((asset) => asset.type === "video"));
    if (!band) continue;
    post.assets.forEach((asset, index) => {
      const frame = cropForPost(post, index);
      if (!frame?.cropped) return;
      findings.push(
        makeFinding(ctx, {
          ruleId: "aspect-ratio",
          severity: "high",
          title: "Image is outside the usual crop",
          detail: `${asset.width}×${asset.height} is ${((asset.width ?? 1) / (asset.height ?? 1)).toFixed(2)}:1. ${post.service} ${post.postType ?? "post"} is usually ${band.label}. The preview shows the centered crop. Best-effort: Buffer does not publish an aspect-ratio rule, and a zero dimension is ignored.`,
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
