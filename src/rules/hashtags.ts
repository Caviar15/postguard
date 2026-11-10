import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

export function hashtags(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    const tags = post.text.match(/#[\p{L}\p{N}_]+/gu) ?? [];
    if (post.service === "instagram" && tags.length > 30) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "hashtags",
          severity: "high",
          title: "More than 30 hashtags",
          detail: `${tags.length} hashtags. Instagram's long-standing cap is 30. Buffer's schema does not expose a hashtag rule, so treat this as a warning and confirm against current Meta limits.`,
          post,
          channelId: post.channelId,
          key: "count",
          advisory: true,
        }),
      );
    }
    if (/#[ \t]/.test(post.text) || /#$/.test(post.text.trim())) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "hashtags",
          severity: "low",
          title: "Broken hashtag",
          detail: "A # is followed by a space or ends the post, so it will not become a tag.",
          post,
          channelId: post.channelId,
          key: "broken",
        }),
      );
    }
  }
  return findings;
}
