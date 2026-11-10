import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

const GRACE_MS = 5 * 60 * 1000;

export function schedule(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    if (post.errorMessage) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "publishing-error",
          severity: "high",
          title: "Buffer already recorded a publishing error",
          detail: post.errorMessage,
          post,
          channelId: post.channelId,
          key: "error",
        }),
      );
    }
    if (post.status === "scheduled" && post.dueAt) {
      const due = new Date(post.dueAt).getTime();
      if (!Number.isNaN(due) && due < ctx.now.getTime() - GRACE_MS) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "schedule",
            severity: "high",
            title: "Publish time has passed and the post is still scheduled",
            detail: `Due at ${post.dueAt}, and the status is still scheduled. It may be stuck behind a paused queue, a disconnected channel, or a previous error.`,
            post,
            channelId: post.channelId,
            key: "overdue",
          }),
        );
      }
    }
    if (post.schedulingType === "notification") {
      findings.push(
        makeFinding(ctx, {
          ruleId: "notification-post",
          severity: "info",
          title: "This post is a reminder, not an automatic publish",
          detail: "schedulingType is notification. Someone has to publish it by hand on a phone, or the slot will pass.",
          post,
          channelId: post.channelId,
          key: "notification",
        }),
      );
    }
  }
  return findings;
}
