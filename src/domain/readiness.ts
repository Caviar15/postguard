import type { Channel, Finding, Post, Severity } from "./types";

export type Readiness = "ready" | "attention" | "fail";

export const READINESS_LABEL: Record<Readiness, string> = {
  ready: "Ready",
  attention: "Needs attention",
  fail: "Will fail",
};

const PENALTY: Record<Severity, number> = {
  blocker: 34,
  high: 18,
  medium: 8,
  low: 3,
  info: 0,
};

export function postReadiness(post: Post, findings: Finding[], channel: Channel | undefined): Readiness {
  const own = findings.filter((finding) => finding.postId === post.id);
  if (own.some((finding) => finding.severity === "blocker") || channel?.isDisconnected || channel?.isLocked) {
    return "fail";
  }
  if (
    own.some((finding) => finding.severity === "high" || finding.severity === "medium") ||
    channel?.isQueuePaused
  ) {
    return "attention";
  }
  return "ready";
}

export function channelScore(findings: Finding[]): number {
  const score = findings.reduce((total, finding) => total - PENALTY[finding.severity], 100);
  return Math.max(0, Math.min(100, score));
}

export function channelReadiness(score: number, posts: Readiness[]): Readiness {
  if (posts.some((readiness) => readiness === "fail") || score < 40) return "fail";
  if (posts.some((readiness) => readiness === "attention") || score < 90) return "attention";
  return "ready";
}

export function riskHeadline(
  posts: Array<{ dueAt: string | null; readiness: Readiness }>,
  now: Date,
): string {
  const risky = posts
    .filter((post) => post.readiness !== "ready" && post.dueAt)
    .map((post) => ({ time: new Date(post.dueAt ?? "").getTime() }))
    .filter((post) => !Number.isNaN(post.time))
    .sort((a, b) => a.time - b.time);
  const next = risky[0];
  if (!next) return "Nothing risky is scheduled in this window.";
  if (next.time <= now.getTime()) return "A risky post is already overdue.";
  const hours = Math.max(1, Math.round((next.time - now.getTime()) / 3_600_000));
  if (hours < 36) return `Next risky post in ${hours} hour${hours === 1 ? "" : "s"}.`;
  const days = Math.round(hours / 24);
  return `Next risky post in ${days} day${days === 1 ? "" : "s"}.`;
}
