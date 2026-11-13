// DEMO-ONLY: remove after Buffer Commit
// A setup-page button that runs the queue check now, includes drafts, emails
// the issues, and does not touch the daily cron's lock, claims, or last-success.

import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { BufferAuthError, BufferRateLimitError } from "@/buffer/client";
import { bufferFixUrl } from "@/buffer/deep-link";
import { serviceLabel } from "@/components/service";
import { findingsForCard } from "@/domain/readiness";
import { SEVERITY_LABEL, type Finding, type ScanReport, type Severity } from "@/domain/types";
import { UnreadableGrantError } from "./crypto";
import { authorizeOwner, crossSite, denyOwner, isSameOrigin, type OwnerAccess } from "./owner";
import { TokenRefreshUnavailableError } from "./grant";
import {
  captionSnippet,
  escapeHtml,
  formatWhen,
  incompleteNotes,
  unsubscribeUrl,
  untilLabel,
} from "./message";
import { AlertStoreError } from "./redis";
import { cardUrl } from "./select";
import type { OutgoingMessage, RunDeps, Subscriber } from "./types";

export const SEND_NOW_LOCK = "alerts-send-now";
export const SEND_NOW_LOCK_MS = 60_000;
/** Wide enough that the 27-hour daily horizon does not hide a post. */
export const DEMO_WINDOW_DAYS = 365;

const DAY = 24 * 3_600_000;
const TIGHT = new Set<Severity>(["blocker", "high"]);

export type DemoAlertItem = {
  key: string;
  postId: string;
  channelId: string;
  channelName: string;
  service: string;
  ruleId: string;
  severity: Severity;
  dueAt: string | null;
  status: string;
  title: string;
  detail: string;
  excerpt: string | null;
  fixUrl: string;
  cardUrl: string;
};

function isKeptFinding(finding: Finding, severities: ReadonlySet<Severity> | "all"): boolean {
  if (finding.advisory) return false;
  return severities === "all" || severities.has(finding.severity);
}

function collectItems(
  report: ScanReport,
  subscriber: Pick<Subscriber, "id">,
  appUrl: string,
  severities: ReadonlySet<Severity> | "all",
): DemoAlertItem[] {
  const items: DemoAlertItem[] = [];
  for (const card of report.cards) {
    const forCard = findingsForCard(report.findings, card);
    const kept = forCard.filter((finding) => isKeptFinding(finding, severities));
    const cardMatches =
      severities === "all" ? card.priority !== "ready" : card.priority === "blocker" || card.priority === "high";
    const dueIso = card.dueAt && Number.isFinite(Date.parse(card.dueAt)) ? new Date(card.dueAt).toISOString() : null;
    const base = {
      postId: card.id,
      channelId: card.channelId,
      channelName: card.channelName,
      service: card.service,
      dueAt: dueIso,
      status: card.status,
      excerpt: card.excerpt || null,
      fixUrl: bufferFixUrl(card.channelId, card.id),
      cardUrl: cardUrl(appUrl, report.organization.id, card.id),
    };
    if (kept.length === 0) {
      if (!cardMatches) continue;
      const reason = [...forCard].sort((a, b) => b.detail.length - a.detail.length)[0];
      const severity: Severity = card.priority === "ready" ? "info" : card.priority;
      items.push({
        ...base,
        key: `${subscriber.id}|${card.id}|${dueIso ?? "undated"}|card:${card.priority}`,
        ruleId: reason?.ruleId ?? "channel-state",
        severity,
        title: reason?.title ?? (card.priority === "blocker" ? "This channel cannot publish" : "This channel's queue needs attention"),
        detail: reason?.detail ?? `${card.channelName} is not in a state to publish this post.`,
      });
      continue;
    }
    for (const finding of kept) {
      items.push({
        ...base,
        key: `${subscriber.id}|${card.id}|${dueIso ?? "undated"}|${finding.id}`,
        ruleId: finding.ruleId,
        severity: finding.severity,
        title: finding.title,
        detail: finding.detail,
      });
    }
  }
  return items;
}

/**
 * Blocker and High first, the same bar as the daily email. If that would be empty, include every
 * non-advisory finding so a demo press still has something to show. No time-window filter.
 */
export function selectDemoAlertItems(
  report: ScanReport,
  subscriber: Pick<Subscriber, "id">,
  appUrl: string,
): { items: DemoAlertItem[]; widened: boolean } {
  const tight = collectItems(report, subscriber, appUrl, TIGHT);
  if (tight.length > 0) return { items: tight, widened: false };
  const all = collectItems(report, subscriber, appUrl, "all");
  return { items: all, widened: all.length > 0 };
}

type Group = { first: DemoAlertItem; items: DemoAlertItem[] };

function group(items: DemoAlertItem[]): Group[] {
  const byPost = new Map<string, Group>();
  for (const item of items) {
    const existing = byPost.get(item.postId);
    if (existing) existing.items.push(item);
    else byPost.set(item.postId, { first: item, items: [item] });
  }
  const rank = (entry: Group) => (entry.items.some((item) => item.severity === "blocker") ? 0 : entry.items.some((item) => item.severity === "high") ? 1 : 2);
  const due = (item: DemoAlertItem) => (item.dueAt ? Date.parse(item.dueAt) : Number.POSITIVE_INFINITY);
  return [...byPost.values()].sort((a, b) => due(a.first) - due(b.first) || rank(a) - rank(b));
}

const INK = "#1c1814";
const SOFT = "#5e564c";
const LINE = "#d9cbb6";
const PAPER = "#f4efe4";
const CARD = "#fffaf3";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Segoe UI','Helvetica Neue',Arial,sans-serif";
const CHIP: Record<Severity, { fg: string; bg: string }> = {
  blocker: { fg: "#8f2d2a", bg: "#f8e4e1" },
  high: { fg: "#9a3412", bg: "#fde7d4" },
  medium: { fg: "#7c5c12", bg: "#f8efd4" },
  low: { fg: "#3d4a2e", bg: "#e7eedc" },
  info: { fg: "#3b4a5c", bg: "#e1e8f2" },
};

function chip(severity: Severity): string {
  const { fg, bg } = CHIP[severity];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${bg};color:${fg};font:700 11px/16px ${SANS};letter-spacing:.04em;text-transform:uppercase;">${SEVERITY_LABEL[severity]}</span>`;
}

function whenLine(item: DemoAlertItem, timeZone: string | null, now: Date): string {
  if (item.status === "draft" && !item.dueAt) return "Draft, no publish time";
  if (!item.dueAt) return "No publish time set";
  const when = formatWhen(item.dueAt, timeZone);
  const future = Date.parse(item.dueAt) > now.getTime();
  if (item.status === "draft") return future ? `Draft · set to publish ${when}, ${untilLabel(item.dueAt, now)}` : `Draft · was set for ${when}`;
  if (future) return `Publishes ${when}, ${untilLabel(item.dueAt, now)}`;
  return `Was set for ${when}`;
}

function renderGroupHtml(entry: Group, subscriber: Pick<Subscriber, "timeZone">, now: Date): string {
  const { first, items } = entry;
  const rows = items
    .map(
      (item) =>
        `<tr><td style="padding:4px 10px 4px 0;vertical-align:top;white-space:nowrap;">${chip(item.severity)}</td><td style="padding:4px 0;font:600 15px/22px ${SANS};color:${INK};">${escapeHtml(item.title)}<br><span style="font:400 13px/19px ${SANS};color:${SOFT};">${escapeHtml(item.detail)}</span></td></tr>`,
    )
    .join("");
  const snippet = captionSnippet(first.excerpt);
  const quote = snippet
    ? `<p style="margin:0 0 10px;padding:8px 12px;border-left:3px solid ${LINE};background:#fff;font:italic 14px/21px ${SERIF};color:${SOFT};">“${escapeHtml(snippet)}”</p>`
    : "";
  return `<tr><td style="padding:0 0 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:10px;"><tr><td style="padding:16px 18px;">
<p style="margin:0 0 2px;font:700 12px/18px ${SANS};letter-spacing:.06em;text-transform:uppercase;color:${SOFT};">${escapeHtml(serviceLabel(first.service))} · ${escapeHtml(first.channelName)}</p>
<p style="margin:0 0 10px;font:600 14px/20px ${SANS};color:${INK};">${escapeHtml(whenLine(first, subscriber.timeZone, now))}</p>
${quote}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">${rows}</table>
<a href="${escapeHtml(first.fixUrl)}" style="display:inline-block;margin:0 8px 6px 0;padding:9px 16px;border-radius:8px;background:${INK};color:#fff;font:700 14px/20px ${SANS};text-decoration:none;">Fix in Buffer</a>
<a href="${escapeHtml(first.cardUrl)}" style="display:inline-block;margin:0 0 6px;padding:8px 15px;border-radius:8px;border:1px solid ${INK};color:${INK};font:700 14px/20px ${SANS};text-decoration:none;">See it in PostGuard</a>
</td></tr></table></td></tr>`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const TEST_NOTE = "This was sent on demand from the setup page and includes drafts. It is not the daily scheduled check.";

export function renderTestMessage(
  items: DemoAlertItem[],
  subscriber: Subscriber,
  ctx: { now: Date; appUrl: string; report: Pick<ScanReport, "notes">; widened: boolean },
): OutgoingMessage {
  const groups = group(items);
  const posts = groups.length;
  const unsubscribe = unsubscribeUrl(ctx.appUrl, subscriber.unsubscribeToken);
  const notes = incompleteNotes(ctx.report);
  const lead = `${plural(posts, "post has", "posts have")} a problem.`;
  const widen = ctx.widened ? " No Blocker or High issues were found, so this test email includes every severity." : "";
  const reads = "PostGuard only reads your Buffer queue. It never edits, pauses, schedules or publishes anything.";

  const lines: string[] = [`[Test]`, "", TEST_NOTE + widen, "", `PostGuard: ${lead}`, ""];
  for (const entry of groups) {
    const { first } = entry;
    lines.push(`${serviceLabel(first.service)} · ${first.channelName}`);
    lines.push(whenLine(first, subscriber.timeZone, ctx.now));
    const snippet = captionSnippet(first.excerpt);
    if (snippet) lines.push(`Caption: “${snippet}”`);
    for (const item of entry.items) lines.push(`  [${SEVERITY_LABEL[item.severity]}] ${item.title}: ${item.detail}`);
    lines.push(`Open the channel in Buffer: ${first.fixUrl}`);
    lines.push(`See it in PostGuard: ${first.cardUrl}`, "");
  }
  for (const note of notes) lines.push(`This check was incomplete: ${note}`);
  if (notes.length) lines.push("");
  lines.push(reads, "", `Stop these emails: ${unsubscribe}`);

  const banner = `<tr><td style="padding:0 0 14px;"><p style="margin:0;padding:10px 14px;border-radius:8px;background:#e1e8f2;color:#1e3a5f;font:600 13px/19px ${SANS};">${escapeHtml(TEST_NOTE + widen)}</p></td></tr>`;
  const incomplete = notes.length
    ? `<tr><td style="padding:0 0 12px;"><p style="margin:0;padding:10px 14px;border-radius:8px;background:#fde7d4;color:#7c2d12;font:600 13px/19px ${SANS};">This check was incomplete. ${escapeHtml(notes.join(" "))}</p></td></tr>`
    : "";
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
${banner}<tr><td style="padding:0 0 4px;"><p style="margin:0;font:700 12px/18px ${SANS};letter-spacing:.08em;text-transform:uppercase;color:#8f2d2a;">PostGuard test alert</p></td></tr>
<tr><td style="padding:0 0 6px;"><h1 style="margin:0;letter-spacing:0;font:600 26px/32px ${SERIF};color:${INK};">${escapeHtml(plural(posts, "post needs", "posts need"))} attention.</h1></td></tr>
<tr><td style="padding:0 0 18px;"><p style="margin:0;font:15px/23px ${SANS};color:${SOFT};">${escapeHtml(TEST_NOTE + widen)}</p></td></tr>
${incomplete}${groups.map((entry) => renderGroupHtml(entry, subscriber, ctx.now)).join("\n")}
<tr><td style="padding:14px 0 0;"><p style="margin:0;font:12px/18px ${SANS};color:${SOFT};">${escapeHtml(reads)} <a href="${escapeHtml(unsubscribe)}" style="color:${SOFT};">Stop these emails</a></p></td></tr>
</table></td></tr></table>`;

  return {
    to: subscriber.email,
    subject: `[Test] PostGuard: ${plural(posts, "post needs", "posts need")} attention`,
    text: lines.join("\n"),
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

function back(request: Request, query: string): Response {
  return NextResponse.redirect(new URL(`/alerts/setup?${query}`, request.url), 303);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

function isGrantError(error: unknown): boolean {
  if (error instanceof BufferAuthError || error instanceof UnreadableGrantError) return true;
  return error instanceof Error && error.message.includes("/alerts/setup");
}

/**
 * POST /api/alerts/send-now. Same-origin POST from the alert owner's signed-in session; no typed code.
 * Never claims, never writes last-success, and never takes the daily cron lock.
 */
export async function handleSendNow(
  request: Request,
  deps: RunDeps,
  authorize: () => Promise<OwnerAccess> = authorizeOwner,
): Promise<Response> {
  if (!isSameOrigin(request)) return crossSite();
  const access = await authorize();
  if (access.status !== "owner") return denyOwner(request, access);

  // Only for the owner: anyone else learns nothing about what is configured.
  const redisUrl = (deps.env.KV_REST_API_URL || deps.env.UPSTASH_REDIS_REST_URL || "").trim();
  const redisToken = (deps.env.KV_REST_API_TOKEN || deps.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!redisUrl || !redisToken) return back(request, "problem=store");

  let release: (() => Promise<void>) | null | undefined;
  try {
    release = await deps.store.acquireLock(SEND_NOW_LOCK, SEND_NOW_LOCK_MS);
  } catch {
    deps.log.warn("alerts: send-now could not take its rate-limit lock");
    return back(request, "problem=store");
  }
  if (!release) return back(request, "problem=test-wait");
  // Keep the lock until it expires so a second press within 60 s is refused. Do not release it.

  const subscribers = await deps.store.listSubscribers().catch((error: unknown) => {
    if (error instanceof UnreadableGrantError) return "grant" as const;
    deps.log.warn("alerts: send-now could not list subscribers", { error: errorName(error) });
    return "store" as const;
  });
  if (subscribers === "grant") return back(request, "problem=test-grant");
  if (subscribers === "store") return back(request, "problem=store");

  const subscriber = subscribers.find((entry) => !entry.unsubscribed && entry.credentials.refreshToken);
  if (!subscriber) return back(request, "problem=test-grant");
  if (!subscriber.email) return back(request, "problem=test-email");
  if (deps.mailer.configured?.() === false) return back(request, "problem=test-mail");

  const now = deps.now();
  const window = { from: now, to: new Date(now.getTime() + DEMO_WINDOW_DAYS * DAY), includeDrafts: true };
  let report: ScanReport;
  try {
    report = await deps.reader.scan(subscriber, window);
  } catch (error) {
    if (error instanceof BufferRateLimitError) {
      deps.log.warn("alerts: send-now could not read the queue", { error: errorName(error) });
      return back(request, "problem=test-read");
    }
    if (error instanceof TokenRefreshUnavailableError || error instanceof AlertStoreError) {
      deps.log.warn("alerts: send-now could not read the queue", { error: errorName(error) });
      return back(request, isGrantError(error) ? "problem=test-grant" : "problem=test-read");
    }
    if (isGrantError(error)) {
      deps.log.warn("alerts: send-now has no usable grant", { error: errorName(error) });
      return back(request, "problem=test-grant");
    }
    deps.log.warn("alerts: send-now could not read the queue", { error: errorName(error) });
    return back(request, "problem=test-read");
  }

  const { items, widened } = selectDemoAlertItems(report, subscriber, deps.config.appUrl);
  if (items.length === 0) return back(request, "problem=test-empty");

  const message = renderTestMessage(items, subscriber, { now, appUrl: deps.config.appUrl, report, widened });
  const idempotencyKey = createHash("sha256")
    .update(`send-now\n${subscriber.id}\n${randomBytes(16).toString("hex")}\n${now.toISOString()}`)
    .digest("hex");
  try {
    await deps.mailer.send(message, { idempotencyKey });
  } catch (error) {
    deps.log.warn("alerts: send-now mail failed", { error: errorName(error) });
    return back(request, "problem=test-mail");
  }

  deps.log.info("alerts: send-now sent a test email", { issues: items.length, widened });
  return back(request, `sent=1&issues=${items.length}`);
}
