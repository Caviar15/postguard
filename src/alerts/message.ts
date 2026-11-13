import { serviceLabel } from "@/components/service";
import type { ScanReport } from "@/domain/types";
import type { AlertItem, OutgoingMessage, Subscriber } from "./types";

const HOUR = 3_600_000;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolves to the zone itself when Intl knows it, else null (times are then labelled UTC). */
export function safeZone(zone: string | null | undefined): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** "Fri 13 Nov, 16:00 CET (Europe/Amsterdam)". The zone is the person's, never silently UTC. */
export function formatWhen(iso: string, timeZone: string | null): string {
  const zone = safeZone(timeZone);
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone ?? "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(new Date(iso));
  return `${label} (${zone ?? "UTC"})`;
}

/** "in about 5 hours", measured in instants, so a 25-hour DST day cannot skew it. */
export function untilLabel(iso: string, now: Date): string {
  const hours = Math.round((Date.parse(iso) - now.getTime()) / HOUR);
  if (hours < 1) return "within the hour";
  return `in about ${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Scan notes that mean the queue was not read in full. */
const INCOMPLETE = /stopped (early|after)|could not be loaded|more than (one page|50)|left out of this scan|link checks failed|were not checked|only one is included/i;

export function incompleteNotes(report: Pick<ScanReport, "notes">): string[] {
  return report.notes.filter((note) => INCOMPLETE.test(note));
}

/** A caption snippet with links replaced, so a link in it is never shown as a verdict about that link. */
export function captionSnippet(value: string | null, max = 140): string | null {
  const clean = (value ?? "").replace(/https?:\/\/\S+/gi, "[link]").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : clean;
}

export function unsubscribeUrl(appUrl: string, token: string): string {
  const url = new URL("/api/alerts/unsubscribe", appUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

type Group = { first: AlertItem; items: AlertItem[] };

function group(items: AlertItem[]): Group[] {
  const byPost = new Map<string, Group>();
  for (const item of items) {
    const existing = byPost.get(item.postId);
    if (existing) existing.items.push(item);
    else byPost.set(item.postId, { first: item, items: [item] });
  }
  const rank = (entry: Group) => (entry.items.some((item) => item.severity === "blocker") ? 0 : 1);
  return [...byPost.values()].sort((a, b) => Date.parse(a.first.dueAt) - Date.parse(b.first.dueAt) || rank(a) - rank(b));
}

const LABEL = { blocker: "Blocker", high: "High" } as const;

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export type RenderContext = {
  now: Date;
  appUrl: string;
  report: Pick<ScanReport, "notes">;
  /** Shown as a banner. Only the /demo/alert page sets it. */
  previewLabel?: string;
  hoursAhead?: number;
};

const INK = "#1c1814";
const SOFT = "#5e564c";
const LINE = "#d9cbb6";
const PAPER = "#f4efe4";
const CARD = "#fffaf3";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Segoe UI','Helvetica Neue',Arial,sans-serif";
const CHIP = {
  blocker: { fg: "#8f2d2a", bg: "#f8e4e1" },
  high: { fg: "#9a3412", bg: "#fde7d4" },
} as const;

function chip(severity: "blocker" | "high"): string {
  const { fg, bg } = CHIP[severity];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${bg};color:${fg};font:700 11px/16px ${SANS};letter-spacing:.04em;text-transform:uppercase;">${LABEL[severity]}</span>`;
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
<p style="margin:0 0 10px;font:600 14px/20px ${SANS};color:${INK};">Publishes ${escapeHtml(formatWhen(first.dueAt, subscriber.timeZone))}, ${escapeHtml(untilLabel(first.dueAt, now))}</p>
${quote}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">${rows}</table>
<a href="${escapeHtml(first.fixUrl)}" style="display:inline-block;margin:0 8px 6px 0;padding:9px 16px;border-radius:8px;background:${INK};color:#fff;font:700 14px/20px ${SANS};text-decoration:none;">Fix in Buffer</a>
<a href="${escapeHtml(first.cardUrl)}" style="display:inline-block;margin:0 0 6px;padding:8px 15px;border-radius:8px;border:1px solid ${INK};color:${INK};font:700 14px/20px ${SANS};text-decoration:none;">See it in PostGuard</a>
</td></tr></table></td></tr>`;
}

export function renderMessage(items: AlertItem[], subscriber: Subscriber, ctx: RenderContext): OutgoingMessage {
  const groups = group(items);
  const posts = groups.length;
  const hours = ctx.hoursAhead ?? 27;
  const unsubscribe = unsubscribeUrl(ctx.appUrl, subscriber.unsubscribeToken);
  const notes = incompleteNotes(ctx.report);
  const scope = `PostGuard checked posts scheduled in roughly the next ${hours} hours. It runs once a day, so a post added or changed after that check may not be looked at before it publishes.`;
  const reads = "PostGuard only reads your Buffer queue. It never edits, pauses, schedules or publishes anything.";
  const lead = `${plural(posts, "scheduled post has", "scheduled posts have")} a Blocker or High problem.`;

  const lines: string[] = [];
  if (ctx.previewLabel) lines.push(`[${ctx.previewLabel}]`, "");
  lines.push(`PostGuard: ${lead}`, scope, "");
  for (const entry of groups) {
    const { first } = entry;
    lines.push(`${serviceLabel(first.service)} · ${first.channelName}`);
    lines.push(`Publishes ${formatWhen(first.dueAt, subscriber.timeZone)}, ${untilLabel(first.dueAt, ctx.now)}`);
    const snippet = captionSnippet(first.excerpt);
    if (snippet) lines.push(`Caption: “${snippet}”`);
    for (const item of entry.items) lines.push(`  [${LABEL[item.severity]}] ${item.title}: ${item.detail}`);
    lines.push(`Open the channel in Buffer (find the post at ${formatWhen(first.dueAt, subscriber.timeZone)}): ${first.fixUrl}`);
    lines.push(`See it in PostGuard: ${first.cardUrl}`, "");
  }
  for (const note of notes) lines.push(`This check was incomplete: ${note}`);
  if (notes.length) lines.push("");
  lines.push(reads, "", `Stop these emails: ${unsubscribe}`);
  const text = lines.join("\n");

  const banner = ctx.previewLabel
    ? `<tr><td style="padding:0 0 14px;"><p style="margin:0;padding:10px 14px;border-radius:8px;background:#e1e8f2;color:#1e3a5f;font:600 13px/19px ${SANS};">${escapeHtml(ctx.previewLabel)}</p></td></tr>`
    : "";
  const incomplete = notes.length
    ? `<tr><td style="padding:0 0 12px;"><p style="margin:0;padding:10px 14px;border-radius:8px;background:#fde7d4;color:#7c2d12;font:600 13px/19px ${SANS};">This check was incomplete. ${escapeHtml(notes.join(" "))}</p></td></tr>`
    : "";
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
${banner}<tr><td style="padding:0 0 4px;"><p style="margin:0;font:700 12px/18px ${SANS};letter-spacing:.08em;text-transform:uppercase;color:#8f2d2a;">PostGuard alert</p></td></tr>
<tr><td style="padding:0 0 6px;"><h1 style="margin:0;letter-spacing:0;font:600 26px/32px ${SERIF};color:${INK};">${escapeHtml(plural(posts, "scheduled post needs", "scheduled posts need"))} attention.</h1></td></tr>
<tr><td style="padding:0 0 18px;"><p style="margin:0;font:15px/23px ${SANS};color:${SOFT};">${escapeHtml(scope)}</p></td></tr>
${incomplete}${groups.map((entry) => renderGroupHtml(entry, subscriber, ctx.now)).join("\n")}
<tr><td style="padding:14px 0 0;"><p style="margin:0;font:12px/18px ${SANS};color:${SOFT};">${escapeHtml(reads)} <a href="${escapeHtml(unsubscribe)}" style="color:${SOFT};">Stop these emails</a></p></td></tr>
</table></td></tr></table>`;

  const hasBlocker = items.some((item) => item.severity === "blocker");
  return {
    to: subscriber.email,
    subject: `PostGuard: ${plural(posts, "scheduled post needs", "scheduled posts need")} attention before publishing${hasBlocker ? " (Blocker)" : ""}`,
    text,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export type CheckFailure = "auth" | "rate-limit" | "unavailable";

/**
 * Sent when the daily check could not read the queue. Silence is the product's "all clear", so a check that did not
 * run must not be silent: without this the owner hears nothing, day after day, after a revoked grant or an outage.
 */
export function renderCheckFailed(subscriber: Subscriber, ctx: { appUrl: string; reason: CheckFailure }): OutgoingMessage {
  const unsubscribe = unsubscribeUrl(ctx.appUrl, subscriber.unsubscribeToken);
  const setup = new URL("/alerts/setup", ctx.appUrl).toString();
  const dashboard = new URL("/dashboard", ctx.appUrl).toString();
  const why =
    ctx.reason === "auth"
      ? `Buffer did not accept PostGuard's saved alert sign-in, so today's check did not run. Turn alerts on again at ${setup}`
      : ctx.reason === "rate-limit"
        ? "Buffer's rate limit was used up, so today's check did not run. PostGuard tries again at the next daily check."
        : "PostGuard could not read your queue from Buffer (no answer, or an error), so today's check did not run. PostGuard tries again at the next daily check.";
  const meaning = `Until a check succeeds, no email does not mean nothing is wrong. You can scan your queue now: ${dashboard}`;
  const reads = "PostGuard only reads your Buffer queue. It never edits, pauses, schedules or publishes anything.";
  const text = [why, "", meaning, "", reads, "", `Stop these emails: ${unsubscribe}`].join("\n");
  const para = (value: string) => `<p style="margin:0 0 14px;font:15px/23px ${SANS};color:${INK};">${escapeHtml(value)}</p>`;
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;"><tr><td>
<p style="margin:0 0 4px;font:700 12px/18px ${SANS};letter-spacing:.08em;text-transform:uppercase;color:#8f2d2a;">PostGuard alert</p>
<h1 style="margin:0 0 12px;font:600 24px/30px ${SERIF};color:${INK};">Today's check did not run.</h1>
${para(why)}${para(meaning)}
<p style="margin:14px 0 0;font:12px/18px ${SANS};color:${SOFT};">${escapeHtml(reads)} <a href="${escapeHtml(unsubscribe)}" style="color:${SOFT};">Stop these emails</a></p>
</td></tr></table></td></tr></table>`;
  return {
    to: subscriber.email,
    subject: "PostGuard could not check your Buffer queue today",
    text,
    html,
    headers: { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
