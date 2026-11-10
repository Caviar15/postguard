import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";
import { utf16Length } from "./text";

export function fieldLimits(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    if ((post.service === "pinterest" || post.service === "youtube") && post.title) {
      const length = utf16Length(post.title);
      if (length > 100) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "field-limits",
            severity: "blocker",
            title: `${post.service === "youtube" ? "YouTube" : "Pinterest"} title is over 100 characters`,
            detail: `${length} of 100. Buffer rejects these titles.`,
            post,
            channelId: post.channelId,
            key: "title",
          }),
        );
      }
      if (post.service === "youtube" && (post.title.includes("<") || post.title.includes(">"))) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "field-limits",
            severity: "blocker",
            title: "YouTube title contains < or >",
            detail: "Buffer rejects a YouTube title that contains < or >.",
            post,
            channelId: post.channelId,
            key: "title-brackets",
          }),
        );
      }
    }

    if (post.service === "threads" && post.topic) {
      const topic = post.topic;
      const length = utf16Length(topic);
      const problems: string[] = [];
      if (length > 50) problems.push(`${length} characters, limit is 50`);
      if (topic.includes("&")) problems.push("contains &");
      if (topic.includes(".")) problems.push("contains .");
      if (problems.length > 0) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "field-limits",
            severity: "blocker",
            title: "Threads topic is not valid",
            detail: `Topic "${topic}": ${problems.join("; ")}.`,
            post,
            channelId: post.channelId,
            key: "topic",
          }),
        );
      }
    }
  }
  return findings;
}
