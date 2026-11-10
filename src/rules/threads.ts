import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";
import { METHOD_NOTE, countText, postLimit } from "./limits";

export function threadLengths(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    if (post.thread.length === 0) continue;
    const limit = postLimit(post, ctx.channelById.get(post.channelId));
    if (!limit) continue;
    post.thread.forEach((item, index) => {
      const counted = countText(item.text, limit.method);
      if (counted > limit.limit) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "thread-length",
            severity: "blocker",
            title: `Thread post ${index + 1} is over the limit`,
            detail: `${counted.toLocaleString("en-US")} of ${limit.limit.toLocaleString("en-US")}. ${METHOD_NOTE[limit.method]}`,
            post,
            channelId: post.channelId,
            key: `item-${index}`,
          }),
        );
      }
    });
  }
  return findings;
}
