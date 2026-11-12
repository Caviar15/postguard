import type { AltSuggestion, Channel, CropPreview, LinkStatus, Post, PostCard, QuotaWindow, ScanReport, Severity } from "@/domain/types";
import { emptyTotals, headline } from "@/domain/headline";
import { channelPriority, channelScore, postPriority, riskHeadline } from "@/domain/readiness";
import { copyUrls, mediaUrls } from "@/domain/urls";
import { bufferFixUrl } from "@/buffer/deep-link";
import { quotaLabel } from "@/buffer/rate-limit";
import { staticUrlRisk } from "@/links/risk";
import { checkMany, type CheckOptions } from "@/links/checker";
import { cropForPost } from "@/rules/crop";
import { excerpt } from "@/rules/context";
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
  includeDrafts?: boolean;
  suggestions?: AltSuggestion[];
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

  const cards = buildCards(input.posts, input.channels, findings);
  return {
    scannedAt: input.now.toISOString(),
    windowDays: input.windowDays,
    mode: input.mode,
    includeDrafts: input.includeDrafts ?? false,
    organization: input.organization,
    postsScanned: input.posts.length,
    riskHeadline: riskHeadline(cards, input.now),
    cards,
    channels: input.channels.map((channel) => {
      const channelFindings = findings.filter((finding) => finding.channelId === channel.id);
      const priorities = cards.filter((card) => card.channelId === channel.id).map((card) => card.priority);
      const score = channelScore(channelFindings, channel);
      return {
        id: channel.id,
        name: channel.displayName || channel.name,
        service: channel.service,
        isDisconnected: channel.isDisconnected,
        isLocked: channel.isLocked,
        isQueuePaused: channel.isQueuePaused,
        postCount: input.posts.filter((post) => post.channelId === channel.id).length,
        findingCount: channelFindings.length,
        score,
        priority: channelPriority(priorities, channel),
      };
    }),
    findings,
    totals,
    headline: headline(findings, input.windowDays),
    suggestions: input.suggestions ?? [],
    quota: {
      label: input.mode === "demo" ? "Demo mode uses none of the shared Buffer quota." : quotaLabel(input.quotaWindows),
      windows: input.quotaWindows,
    },
    requestsUsed: input.requestsUsed,
    cached: input.cached,
    notes,
  };
}

function buildCards(posts: Post[], channels: Channel[], findings: ScanReport["findings"]): PostCard[] {
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  return [...posts]
    .sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"))
    .map((post) => {
      const channel = byId.get(post.channelId);
      const frame = cropForPost(post, post.assets.findIndex((asset) => asset.type === "image" || asset.type === "video"));
      const asset = post.assets.find((item) => item.type === "image" || item.type === "video");
      const preview: CropPreview | null = frame && asset?.width && asset.height
        ? {
            src: asset.type === "image" ? asset.source : asset.thumbnail,
            width: asset.width,
            height: asset.height,
            label: frame.label,
            cropped: frame.cropped,
            top: frame.top,
            bottom: frame.bottom,
            left: frame.left,
            right: frame.right,
          }
        : null;
      return {
        id: post.id,
        channelId: post.channelId,
        channelName: channel?.displayName || channel?.name || post.channelId,
        service: post.service,
        status: post.status,
        dueAt: post.dueAt,
        timeZone: channel?.timezone ?? null,
        excerpt: excerpt(post.text),
        priority: postPriority(post, findings, channel),
        fixUrl: bufferFixUrl(post.channelId, post.id),
        needsAlt: post.assets.some((item) => item.type === "image" && !(item.altText ?? "").trim()),
        preview,
      };
    });
}
