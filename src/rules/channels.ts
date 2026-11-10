import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

export function channelHealth(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const channel of ctx.channels) {
    const queued = ctx.posts.filter((post) => post.channelId === channel.id);
    if (queued.length === 0) continue;
    const name = channel.displayName || channel.name;
    if (channel.isDisconnected) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "channel-disconnected",
          severity: "blocker",
          title: "Disconnected channel still has posts queued",
          detail: `${name} is disconnected, and ${queued.length} post${queued.length === 1 ? "" : "s"} in this window will not publish.`,
          channelId: channel.id,
          service: channel.service,
          key: "disconnected",
        }),
      );
    }
    if (channel.isLocked) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "channel-locked",
          severity: "blocker",
          title: "Locked channel still has posts queued",
          detail: `${name} is locked, so Buffer will not publish the ${queued.length} post${queued.length === 1 ? "" : "s"} queued on it.`,
          channelId: channel.id,
          service: channel.service,
          key: "locked",
        }),
      );
    }
    if (channel.isQueuePaused) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "channel-paused",
          severity: "info",
          title: "Queue is paused",
          detail: `${name} is paused. ${queued.length} post${queued.length === 1 ? "" : "s"} in this window will sit there until someone unpauses the queue.`,
          channelId: channel.id,
          service: channel.service,
          key: "paused",
        }),
      );
    }
  }
  return findings;
}
