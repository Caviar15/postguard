import type { Channel, Finding, Post, Priority, Severity } from "./types";

export type { Priority };

export const PRIORITY_LABEL: Record<Priority, string> = {
  blocker: "Blocker",
  high: "High",
  medium: "Medium",
  low: "Low",
  ready: "Ready",
};

const RANK: Record<Priority, number> = {
  blocker: 0,
  high: 1,
  medium: 2,
  low: 3,
  ready: 4,
};

const PENALTY: Record<Severity, number> = {
  blocker: 34,
  high: 18,
  medium: 8,
  low: 3,
  info: 0,
};

const RISKY: ReadonlySet<Priority> = new Set(["blocker", "high", "medium"]);

function tighter(current: Priority, next: Priority): Priority {
  return RANK[next] < RANK[current] ? next : current;
}

/** Highest finding on the post. Info does not raise it. A locked or disconnected channel is Blocker; a paused queue is at least High. */
export function postPriority(post: Post, findings: Finding[], channel: Channel | undefined): Priority {
  if (channel?.isDisconnected || channel?.isLocked) return "blocker";
  let priority: Priority = "ready";
  for (const finding of findings) {
    if (finding.postId !== post.id || finding.severity === "info") continue;
    priority = tighter(priority, finding.severity);
  }
  if (channel?.isQueuePaused) priority = tighter(priority, "high");
  return priority;
}

/** Worst post on the channel. The same channel flags apply when the channel has no posts. */
export function channelPriority(
  priorities: Priority[],
  channel: Pick<Channel, "isDisconnected" | "isLocked" | "isQueuePaused"> | undefined,
): Priority {
  if (channel?.isDisconnected || channel?.isLocked) return "blocker";
  let priority: Priority = priorities.reduce<Priority>((current, next) => tighter(current, next), "ready");
  if (channel?.isQueuePaused) priority = tighter(priority, "high");
  return priority;
}

export function channelScore(findings: Finding[]): number {
  const score = findings.reduce((total, finding) => total - PENALTY[finding.severity], 100);
  return Math.max(0, Math.min(100, score));
}

export function riskHeadline(
  posts: Array<{ dueAt: string | null; priority: Priority }>,
  now: Date,
): string {
  const risky = posts
    .filter((post) => RISKY.has(post.priority) && post.dueAt)
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

/** Soonest publish time first. Posts with no time sort after every dated post. */
export function compareByTime(a: { dueAt: string | null }, b: { dueAt: string | null }): number {
  if (a.dueAt && b.dueAt) return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return 0;
}

/** Blocker, then High, Medium, Low, Ready. Ties break by publish time. */
export function compareByPriority(a: { priority: Priority; dueAt: string | null }, b: { priority: Priority; dueAt: string | null }): number {
  const rank = RANK[a.priority] - RANK[b.priority];
  if (rank !== 0) return rank;
  return compareByTime(a, b);
}
