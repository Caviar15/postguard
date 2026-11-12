import { serviceLabel } from "@/components/service";
import type { Finding, ScanReport, Severity } from "@/domain/types";

/** The alert is for things that will actually break. Medium and below stay on the dashboard. */
export const ALERT_SEVERITIES: Severity[] = ["blocker", "high"];

export const ALERT_TIME_ZONE = "Europe/Amsterdam";

export type AlertFinding = { severity: "blocker" | "high"; title: string };

export type AlertPost = {
  key: string;
  channelName: string;
  service: string;
  serviceLabel: string;
  dueAt: string | null;
  whenLabel: string;
  /** Null when the finding is about the whole channel, not one post. */
  excerpt: string | null;
  findings: AlertFinding[];
  fixUrl: string;
};

export type Alert = {
  posts: AlertPost[];
  blockers: number;
  high: number;
  subject: string;
  html: string;
  text: string;
};

export type AlertOptions = {
  /** Where the "Open PostGuard" link points. */
  dashboardUrl: string;
  /** Set for the /demo/alert page. Adds a visible sample-data banner. Never set for a real send. */
  previewLabel?: string;
  timeZone?: string;
};

function isAlertFinding(finding: Finding): finding is Finding & { severity: "blocker" | "high" } {
  return finding.severity === "blocker" || finding.severity === "high";
}

export function snippet(value: string | null | undefined, max = 140): string | null {
  const clean = (value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  // Cut by code point: the demo (and real posts) use mathematical bold letters, which are surrogate pairs.
  const chars = Array.from(clean);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : clean;
}

export function formatWhen(dueAt: string | null, timeZone = ALERT_TIME_ZONE): string {
  if (!dueAt) return "No publish time";
  const time = Date.parse(dueAt);
  if (Number.isNaN(time)) return "No publish time";
  const label = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(time));
  const zone = timeZone === ALERT_TIME_ZONE ? "Amsterdam time" : timeZone;
  return `${label.replace(",", "")} · ${zone}`;
}

/** Only Blocker and High findings, grouped by post. Soonest publish time first, then Blockers before High. */
export function collectRisky(report: Pick<ScanReport, "findings" | "cards">, timeZone = ALERT_TIME_ZONE): AlertPost[] {
  const cards = new Map(report.cards.map((card) => [card.id, card]));
  const groups = new Map<string, AlertPost>();
  const seen = new Set<string>();
  for (const finding of report.findings) {
    if (!isAlertFinding(finding)) continue;
    const key = finding.postId ?? `channel:${finding.channelId}`;
    const dedupe = `${key}|${finding.ruleId}|${finding.title}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    let post = groups.get(key);
    if (!post) {
      const card = finding.postId ? cards.get(finding.postId) : undefined;
      const dueAt = card?.dueAt ?? finding.dueAt;
      post = {
        key,
        channelName: card?.channelName ?? finding.channelName,
        service: card?.service ?? finding.service,
        serviceLabel: serviceLabel(card?.service ?? finding.service),
        dueAt,
        whenLabel: finding.postId ? formatWhen(dueAt, timeZone) : "Whole channel",
        excerpt: finding.postId ? snippet(card?.excerpt ?? finding.excerpt) : null,
        findings: [],
        fixUrl: card?.fixUrl ?? finding.fixUrl,
      };
      groups.set(key, post);
    }
    post.findings.push({ severity: finding.severity, title: finding.title });
  }
  const rank = (post: AlertPost) => (post.findings.some((item) => item.severity === "blocker") ? 0 : 1);
  return [...groups.values()].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function alertSubject(posts: AlertPost[], blockers: number, high: number): string {
  const parts: string[] = [];
  if (blockers) parts.push(plural(blockers, "blocker", "blockers"));
  if (high) parts.push(plural(high, "high-risk problem", "high-risk problems"));
  return `PostGuard: ${plural(posts.length, "scheduled post needs", "scheduled posts need")} attention (${parts.join(", ")})`;
}

const INK = "#1c1814";
const SOFT = "#5e564c";
const LINE = "#d9cbb6";
const PAPER = "#f4efe4";
const CARD = "#fffaf3";
const BLOCKER = "#8f2d2a";
const BLOCKER_BG = "#f8e4e1";
const HIGH = "#9a3412";
const HIGH_BG = "#fde7d4";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Segoe UI','Helvetica Neue',Arial,sans-serif";

function chip(severity: "blocker" | "high"): string {
  const [fg, bg, label] = severity === "blocker" ? [BLOCKER, BLOCKER_BG, "Blocker"] : [HIGH, HIGH_BG, "High"];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${bg};color:${fg};font:700 11px/16px ${SANS};letter-spacing:.04em;text-transform:uppercase;">${label}</span>`;
}

function renderPostHtml(post: AlertPost): string {
  const rows = post.findings
    .map(
      (item) =>
        `<tr><td style="padding:4px 10px 4px 0;vertical-align:top;white-space:nowrap;">${chip(item.severity)}</td><td style="padding:4px 0;font:600 15px/22px ${SANS};color:${INK};">${escapeHtml(item.title)}</td></tr>`,
    )
    .join("");
  const excerpt = post.excerpt
    ? `<p style="margin:0 0 10px;padding:8px 12px;border-left:3px solid ${LINE};background:#fff;font:italic 14px/21px ${SERIF};color:${SOFT};">“${escapeHtml(post.excerpt)}”</p>`
    : "";
  return `<tr><td style="padding:0 0 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CARD};border:1px solid ${LINE};border-radius:10px;"><tr><td style="padding:16px 18px;">
<p style="margin:0 0 2px;font:700 12px/18px ${SANS};letter-spacing:.06em;text-transform:uppercase;color:${SOFT};">${escapeHtml(post.serviceLabel)} · ${escapeHtml(post.channelName)}</p>
<p style="margin:0 0 10px;font:600 14px/20px ${SANS};color:${INK};">${escapeHtml(post.whenLabel)}</p>
${excerpt}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">${rows}</table>
<a href="${escapeHtml(post.fixUrl)}" style="display:inline-block;padding:9px 16px;border-radius:8px;background:${INK};color:#fff;font:700 14px/20px ${SANS};text-decoration:none;">Fix in Buffer</a>
</td></tr></table></td></tr>`;
}

export function renderAlertHtml(posts: AlertPost[], blockers: number, high: number, options: AlertOptions): string {
  const intro = `${plural(blockers, "blocker", "blockers")} and ${plural(high, "high-risk problem", "high-risk problems")} across ${plural(posts.length, "post", "posts")} in your Buffer queue.`;
  const banner = options.previewLabel
    ? `<tr><td style="padding:0 0 14px;"><p style="margin:0;padding:10px 14px;border-radius:8px;background:#e1e8f2;color:#1e3a5f;font:600 13px/19px ${SANS};">${escapeHtml(options.previewLabel)}</p></td></tr>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;">
${banner}<tr><td style="padding:0 0 4px;"><p style="margin:0;font:700 12px/18px ${SANS};letter-spacing:.08em;text-transform:uppercase;color:${BLOCKER};">PostGuard alert</p></td></tr>
<tr><td style="padding:0 0 6px;"><h1 style="margin:0;letter-spacing:0;font:600 26px/32px ${SERIF};color:${INK};">Some scheduled posts will break.</h1></td></tr>
<tr><td style="padding:0 0 18px;"><p style="margin:0;font:15px/23px ${SANS};color:${SOFT};">${escapeHtml(intro)} Nothing has been changed. PostGuard only reads your queue.</p></td></tr>
${posts.map(renderPostHtml).join("\n")}
<tr><td style="padding:6px 0 0;"><p style="margin:0;font:14px/22px ${SANS};color:${SOFT};"><a href="${escapeHtml(options.dashboardUrl)}" style="color:${INK};font-weight:700;">Open PostGuard</a> to see every check, including lower-priority ones.</p></td></tr>
<tr><td style="padding:14px 0 0;"><p style="margin:0;font:12px/18px ${SANS};color:${SOFT};">You get this email only when a Blocker or High problem is found. Read-only: PostGuard never edits, schedules or publishes anything.</p></td></tr>
</table></td></tr></table>`;
}

export function renderAlertText(posts: AlertPost[], blockers: number, high: number, options: AlertOptions): string {
  const lines: string[] = [];
  if (options.previewLabel) lines.push(`[${options.previewLabel}]`, "");
  lines.push(
    `PostGuard alert: ${plural(blockers, "blocker", "blockers")} and ${plural(high, "high-risk problem", "high-risk problems")} across ${plural(posts.length, "post", "posts")}.`,
    "",
  );
  for (const post of posts) {
    lines.push(`${post.serviceLabel} · ${post.channelName} · ${post.whenLabel}`);
    if (post.excerpt) lines.push(`  “${post.excerpt}”`);
    for (const item of post.findings) lines.push(`  - ${item.severity === "blocker" ? "BLOCKER" : "HIGH"}: ${item.title}`);
    lines.push(`  Fix in Buffer: ${post.fixUrl}`, "");
  }
  lines.push(`Open PostGuard: ${options.dashboardUrl}`, "", "Read-only: PostGuard never edits, schedules or publishes anything.");
  return lines.join("\n");
}

/** Null means there is nothing to say, so nothing is sent. */
export function buildAlert(report: Pick<ScanReport, "findings" | "cards">, options: AlertOptions): Alert | null {
  const posts = collectRisky(report, options.timeZone);
  if (posts.length === 0) return null;
  const all = posts.flatMap((post) => post.findings);
  const blockers = all.filter((item) => item.severity === "blocker").length;
  const high = all.filter((item) => item.severity === "high").length;
  return {
    posts,
    blockers,
    high,
    subject: alertSubject(posts, blockers, high),
    html: renderAlertHtml(posts, blockers, high, options),
    text: renderAlertText(posts, blockers, high, options),
  };
}
