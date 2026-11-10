import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";
import { unicodeBoldCount } from "./text";

export function fakeBold(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    const styled = unicodeBoldCount(post.text);
    if (styled < 4) continue;
    const bluesky = post.service === "bluesky";
    findings.push(
      makeFinding(ctx, {
        ruleId: "fake-bold",
        severity: "low",
        title: "Unicode bold or italic burns the character budget",
        detail: bluesky
          ? `${styled} styled letters. Bluesky counts them as one grapheme each, but screen readers spell them out.`
          : `${styled} styled letters. On this network each one counts as two UTF-16 units, so the post is about twice as long as it looks. Screen readers also spell them out.`,
        post,
        channelId: post.channelId,
        key: "styled",
      }),
    );
  }
  return findings;
}
