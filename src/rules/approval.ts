import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * A post that still needs approval will not publish. Flag it when the slot is
 * inside the next day, or already past. An undated approval is only a pill.
 */
export function approvals(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    if (post.status !== "needs_approval" || !post.dueAt) continue;
    const due = new Date(post.dueAt).getTime();
    if (Number.isNaN(due)) continue;
    const delta = due - ctx.now.getTime();
    if (delta > DAY_MS) continue;
    const overdue = delta <= 0;
    const hours = Math.max(1, Math.round(Math.abs(delta) / HOUR_MS));
    findings.push(
      makeFinding(ctx, {
        ruleId: "needs-approval",
        severity: "high",
        title: overdue ? `Waiting for approval, ${hours}h overdue` : `Waiting for approval, due in ${hours}h`,
        detail: "Buffer won't publish this post until someone approves it.",
        post,
        channelId: post.channelId,
        key: "approval",
      }),
    );
  }
  return findings;
}
