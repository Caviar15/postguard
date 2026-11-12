import { SEVERITY_RANK, type Channel, type Finding, type LinkStatus, type Post } from "@/domain/types";
import { altText } from "./alt";
import { approvals } from "./approval";
import { aspectRatio } from "./aspect";
import { channelHealth } from "./channels";
import type { RuleContext } from "./context";
import { deadLinks } from "./dead-link";
import { duplicates } from "./duplicates";
import { fakeBold } from "./fake-bold";
import { fieldLimits } from "./fields";
import { firstComment } from "./first-comment";
import { hashtags } from "./hashtags";
import { textLength } from "./length";
import { mediaRule } from "./media";
import { placeholders } from "./placeholders";
import { schedule } from "./schedule";
import { threadLengths } from "./threads";

export function runRules(input: {
  posts: Post[];
  channels: Channel[];
  linkResults: Map<string, LinkStatus>;
  now: Date;
}): Finding[] {
  const ctx: RuleContext = {
    ...input,
    channelById: new Map(input.channels.map((channel) => [channel.id, channel])),
  };
  const findings = [
    ...deadLinks(ctx),
    ...mediaRule(ctx),
    ...textLength(ctx),
    ...fakeBold(ctx),
    ...firstComment(ctx),
    ...fieldLimits(ctx),
    ...threadLengths(ctx),
    ...aspectRatio(ctx),
    ...altText(ctx),
    ...duplicates(ctx),
    ...channelHealth(ctx),
    ...schedule(ctx),
    ...approvals(ctx),
    ...placeholders(ctx),
    ...hashtags(ctx),
  ];
  return findings.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
  });
}
