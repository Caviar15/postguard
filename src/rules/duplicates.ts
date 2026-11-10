import type { Finding, Post } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  return text.split(" ").filter(Boolean);
}

function shingles(tokens: string[], size = 3): Set<string> {
  if (tokens.length === 0) return new Set();
  if (tokens.length < size) return new Set([tokens.join(" ")]);
  const set = new Set<string>();
  for (let i = 0; i <= tokens.length - size; i += 1) set.add(tokens.slice(i, i + size).join(" "));
  return set;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function hoursApart(left: string | null, right: string | null): number | null {
  if (!left || !right) return null;
  const a = new Date(left).getTime();
  const b = new Date(right).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(a - b) / 3_600_000;
}

function sharedMedia(left: Post, right: Post): string | null {
  const sources = new Set(left.assets.map((asset) => asset.source).filter((source) => source.startsWith("http")));
  for (const asset of right.assets) {
    if (sources.has(asset.source)) return asset.source;
  }
  return null;
}

export function duplicates(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  const prepared = ctx.posts.map((post) => {
    const normalized = normalize(post.text);
    const tokens = words(normalized);
    return { post, normalized, tokens, shingles: shingles(tokens) };
  });

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const a = prepared[i];
      const b = prepared[j];
      if (!a || !b) continue;
      const sameChannel = a.post.channelId === b.post.channelId;
      const hours = hoursApart(a.post.dueAt, b.post.dueAt);
      const inWindow = hours === null ? true : sameChannel ? hours <= 24 : hours <= 1;
      if (!inWindow) continue;

      const exact = a.normalized.length >= 20 && a.normalized === b.normalized;
      const near =
        !exact && a.tokens.length >= 8 && b.tokens.length >= 8 && jaccard(a.shingles, b.shingles) >= 0.9;
      const media = sharedMedia(a.post, b.post);
      if (!exact && !near && !media) continue;

      const later = (b.post.dueAt ?? "") >= (a.post.dueAt ?? "") ? b.post : a.post;
      const earlier = later === b.post ? a.post : b.post;
      const severity = sameChannel && hours !== null && hours <= 24 ? "high" : "medium";
      const why = exact ? "The text matches" : near ? "The text is a near duplicate" : "The same media file is attached";
      const when =
        hours === null ? "one or both posts have no publish time" : `${hours.toFixed(1)} hours apart`;
      findings.push(
        makeFinding(ctx, {
          ruleId: "duplicate",
          severity,
          title: sameChannel ? "Duplicate in the same channel" : "Duplicate across channels",
          detail: `${why} (${when}). The other post is ${earlier.id} on ${earlier.service}. Cross-channel matches inside an hour are flagged because they are often an accident, and you can ignore a deliberate cross-post.`,
          post: later,
          channelId: later.channelId,
          key: [a.post.id, b.post.id].sort().join(":"),
        }),
      );
    }
  }
  return findings;
}
