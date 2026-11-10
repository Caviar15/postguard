import { extractUrls } from "@/domain/urls";
import type { Finding, LinkOutcome, Severity } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";
import { METHOD_NOTE, countText, firstCommentLimit } from "./limits";

const LINK_IN_COMMENTS = /link in (the )?(comments|first comment)/i;

const LINK_SEVERITY: Partial<Record<LinkOutcome, Severity>> = {
  dead: "high",
  expiring: "high",
  "private-host": "high",
  "soft-404": "medium",
  insecure: "medium",
  redirect: "medium",
};

export function firstComment(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    if (!post.hasFirstCommentField) continue;
    const spec = firstCommentLimit(post.service);
    const comment = post.firstComment ?? "";
    const promisesAComment = LINK_IN_COMMENTS.test(post.text);

    if (promisesAComment && comment.trim().length === 0) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "first-comment",
          severity: "high",
          title: "Caption points at a first comment that is empty",
          detail: "The post tells people the link is in the comments, and the first comment is blank. It will publish that way.",
          post,
          channelId: post.channelId,
          key: "empty",
        }),
      );
    }

    if (spec && comment.trim().length > 0) {
      const counted = countText(comment, spec.method);
      if (counted > spec.limit) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "first-comment",
            severity: "blocker",
            title: "First comment is over the limit",
            detail: `${counted.toLocaleString("en-US")} of ${spec.limit.toLocaleString("en-US")}. ${METHOD_NOTE[spec.method]}`,
            post,
            channelId: post.channelId,
            key: "over",
          }),
        );
      }
    }

    for (const url of extractUrls(comment)) {
      const status = ctx.linkResults.get(url);
      if (!status) continue;
      const severity = LINK_SEVERITY[status.outcome];
      if (!severity) continue;
      findings.push(
        makeFinding(ctx, {
          ruleId: "first-comment",
          severity,
          title: "First comment has a broken link",
          detail: `${url} — ${status.detail}`,
          post,
          channelId: post.channelId,
          key: `link:${url}`,
        }),
      );
    }
  }
  return findings;
}
