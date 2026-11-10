import { bufferFixUrl } from "@/buffer/deep-link";
import type { Channel, Finding, LinkStatus, Post, Severity } from "@/domain/types";

export type RuleContext = {
  posts: Post[];
  channels: Channel[];
  channelById: Map<string, Channel>;
  linkResults: Map<string, LinkStatus>;
  now: Date;
};

export function excerpt(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

export function channelName(ctx: RuleContext, channelId: string): string {
  const channel = ctx.channelById.get(channelId);
  return channel?.displayName || channel?.name || channelId;
}

export function makeFinding(
  ctx: RuleContext,
  input: {
    ruleId: string;
    severity: Severity;
    title: string;
    detail: string;
    post?: Post | null;
    channelId: string;
    service?: string;
    key: string;
    advisory?: boolean;
  },
): Finding {
  const post = input.post ?? null;
  return {
    id: `${input.ruleId}:${post?.id ?? input.channelId}:${input.key}`,
    ruleId: input.ruleId,
    severity: input.severity,
    title: input.title,
    detail: input.detail,
    postId: post?.id ?? null,
    channelId: input.channelId,
    channelName: channelName(ctx, input.channelId),
    service: input.service ?? post?.service ?? ctx.channelById.get(input.channelId)?.service ?? "unknown",
    dueAt: post?.dueAt ?? null,
    excerpt: post ? excerpt(post.text) : null,
    fixUrl: bufferFixUrl(input.channelId, post?.id),
    advisory: input.advisory ?? false,
  };
}
