import { bufferFixUrl } from "@/buffer/deep-link";
import { findingsForCard } from "@/domain/readiness";
import type { Finding, ScanReport } from "@/domain/types";
import type { AlertConfig, AlertItem, Subscriber } from "./types";

const HOUR = 3_600_000;
const ALERT_SEVERITY = new Set(["blocker", "high"]);

/**
 * How far ahead one run looks. The next scheduled run is `cadenceHours` away and can fire up to
 * `jitterHours` late, and the person needs `leadHours` to act, so a post publishing inside this
 * window could be missed by the next run. Daily Hobby cron: 24 + 1 + 2 = 27 hours.
 */
export function horizonFor(config: Pick<AlertConfig, "cadenceHours" | "jitterHours" | "leadHours">, now: Date): Date {
  return new Date(now.getTime() + (config.cadenceHours + config.jitterHours + config.leadHours) * HOUR);
}

export function cardUrl(appUrl: string, organizationId: string, postId: string): string {
  const url = new URL("/dashboard", appUrl);
  if (organizationId) url.searchParams.set("org", organizationId);
  url.hash = `post-${postId}`;
  return url.toString();
}

function isAlertFinding(finding: Finding): finding is Finding & { severity: "blocker" | "high" } {
  return ALERT_SEVERITY.has(finding.severity) && !finding.advisory;
}

/**
 * The trigger is the post's priority label on the dashboard (Blocker or High), not the raw severity of
 * its findings: a post in a paused queue is High on its card while its only finding is Info.
 */
export function selectAlertItems(
  report: ScanReport,
  subscriber: Pick<Subscriber, "id">,
  ctx: { now: Date; horizonEnd: Date; appUrl: string },
): AlertItem[] {
  const items: AlertItem[] = [];
  for (const card of report.cards) {
    if ((card.priority !== "blocker" && card.priority !== "high") || !card.dueAt) continue;
    const due = Date.parse(card.dueAt);
    if (!Number.isFinite(due) || due <= ctx.now.getTime() || due > ctx.horizonEnd.getTime()) continue;
    const forCard = findingsForCard(report.findings, card);
    const alertFindings = forCard.filter(isAlertFinding);
    // The publish time is part of the dedupe key: a post that was alerted and then moved to a new time without
    // being fixed is a new situation, so it is alerted again. The same post at the same time is never sent twice.
    const dueIso = new Date(due).toISOString();
    const base = {
      postId: card.id,
      channelId: card.channelId,
      channelName: card.channelName,
      service: card.service,
      dueAt: dueIso,
      excerpt: card.excerpt || null,
      fixUrl: bufferFixUrl(card.channelId, card.id),
      cardUrl: cardUrl(ctx.appUrl, report.organization.id, card.id),
    };
    if (alertFindings.length === 0) {
      // The label comes from channel state. Name the reason the dashboard shows for it.
      const reason = [...forCard].sort((a, b) => b.detail.length - a.detail.length)[0];
      items.push({
        ...base,
        key: `${subscriber.id}|${card.id}|${dueIso}|card:${card.priority}`,
        ruleId: reason?.ruleId ?? "channel-state",
        severity: card.priority,
        title: reason?.title ?? (card.priority === "blocker" ? "This channel cannot publish" : "This channel's queue needs attention"),
        detail: reason?.detail ?? `${card.channelName} is not in a state to publish this post.`,
      });
      continue;
    }
    for (const finding of alertFindings) {
      items.push({
        ...base,
        key: `${subscriber.id}|${card.id}|${dueIso}|${finding.id}`,
        ruleId: finding.ruleId,
        severity: finding.severity,
        title: finding.title,
        detail: finding.detail,
      });
    }
  }
  return items;
}
