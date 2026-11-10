import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";
import { METHOD_NOTE, countText, postLimit } from "./limits";

export function textLength(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    const limit = postLimit(post, ctx.channelById.get(post.channelId));
    if (!limit) continue;
    const counted = countText(post.text, limit.method);
    const how = METHOD_NOTE[limit.method];
    const assumption = limit.note ? ` ${limit.note}` : "";
    if (counted > limit.limit) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "text-length",
          severity: "blocker",
          title: "Over the character limit",
          detail: `${counted.toLocaleString("en-US")} of ${limit.limit.toLocaleString("en-US")} on ${post.service}. ${how}${assumption}`,
          post,
          channelId: post.channelId,
          key: "over",
        }),
      );
    } else if (counted >= limit.limit * 0.95 && limit.limit > 0) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "text-length",
          severity: "medium",
          title: "Within 5% of the character limit",
          detail: `${counted.toLocaleString("en-US")} of ${limit.limit.toLocaleString("en-US")} on ${post.service}. One added link or emoji can push it over. ${how}${assumption}`,
          post,
          channelId: post.channelId,
          key: "near",
        }),
      );
    }

    if (
      post.service === "youtube" &&
      post.schedulingType !== "notification" &&
      (post.text.includes("<") || post.text.includes(">"))
    ) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "text-length",
          severity: "blocker",
          title: "YouTube description contains < or >",
          detail: "Buffer rejects a YouTube description that contains < or >. Reminder posts are the exception, and this one is set to publish automatically.",
          post,
          channelId: post.channelId,
          key: "youtube-brackets",
        }),
      );
    }
  }
  return findings;
}
