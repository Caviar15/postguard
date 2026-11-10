import type { Channel, LinkStatus, Post, QuotaWindow, ScanReport, Severity } from "@/domain/types";
import { emptyTotals, headline } from "@/domain/headline";
import { copyUrls, mediaUrls } from "@/domain/urls";
import { quotaLabel } from "@/buffer/rate-limit";
import { staticUrlRisk } from "@/links/risk";
import { checkMany, type CheckOptions } from "@/links/checker";
import { runRules } from "@/rules/engine";

export function urlsToCheck(posts: Post[]): { copy: string[]; media: string[] } {
  const copy = new Set<string>();
  const media = new Set<string>();
  for (const post of posts) {
    for (const url of copyUrls(post)) copy.add(url);
    for (const url of mediaUrls(post)) media.add(url);
  }
  return { copy: [...copy], media: [...media] };
}

export async function resolveLinks(
  posts: Post[],
  options: CheckOptions & { preset?: Map<string, LinkStatus>; limit?: number } = {},
): Promise<{ results: Map<string, LinkStatus>; skipped: number }> {
  const { copy, media } = urlsToCheck(posts);
  const ordered = [...new Set([...copy, ...media])];
  const limit = options.limit ?? 40;
  const selected = ordered.slice(0, limit);
  const results = new Map<string, LinkStatus>();
  const toFetch: string[] = [];

  for (const url of selected) {
    const preset = options.preset?.get(url);
    if (preset) {
      results.set(url, preset);
      continue;
    }
    const risk = staticUrlRisk(url);
    if (risk) {
      results.set(url, {
        url,
        outcome: risk.kind,
        status: null,
        hops: 0,
        finalUrl: null,
        detail: risk.reason,
      });
      continue;
    }
    toFetch.push(url);
  }

  if (toFetch.length > 0) {
    const fetched = await checkMany(toFetch, options);
    for (const [url, status] of fetched) results.set(url, status);
  }

  return { results, skipped: Math.max(0, ordered.length - selected.length) };
}

export function assembleReport(input: {
  posts: Post[];
  channels: Channel[];
  linkResults: Map<string, LinkStatus>;
  now: Date;
  windowDays: number;
  mode: "live" | "demo";
  organization: { id: string; name: string };
  quotaWindows: QuotaWindow[];
  requestsUsed: number;
  cached: boolean;
  notes?: string[];
  skippedLinks?: number;
}): ScanReport {
  const findings = runRules({
    posts: input.posts,
    channels: input.channels,
    linkResults: input.linkResults,
    now: input.now,
  });
  const totals = emptyTotals();
  for (const finding of findings) totals[finding.severity as Severity] += 1;

  const notes = [...(input.notes ?? [])];
  if (input.skippedLinks && input.skippedLinks > 0) {
    notes.push(`${input.skippedLinks} URLs were not checked, to keep this scan inside a short function timeout.`);
  }

  return {
    scannedAt: input.now.toISOString(),
    windowDays: input.windowDays,
    mode: input.mode,
    organization: input.organization,
    postsScanned: input.posts.length,
    channels: input.channels.map((channel) => ({
      id: channel.id,
      name: channel.displayName || channel.name,
      service: channel.service,
      isDisconnected: channel.isDisconnected,
      isLocked: channel.isLocked,
      isQueuePaused: channel.isQueuePaused,
      postCount: input.posts.filter((post) => post.channelId === channel.id).length,
      findingCount: findings.filter((finding) => finding.channelId === channel.id).length,
    })),
    findings,
    totals,
    headline: headline(findings, input.windowDays),
    quota: {
      label: input.mode === "demo" ? "Demo mode uses none of the shared Buffer quota." : quotaLabel(input.quotaWindows),
      windows: input.quotaWindows,
    },
    requestsUsed: input.requestsUsed,
    cached: input.cached,
    notes,
  };
}
