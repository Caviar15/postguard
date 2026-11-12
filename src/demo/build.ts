import type { Asset, Channel, LinkStatus, Post, ScanReport, Service } from "@/domain/types";
import { linkedInLength, mathBold } from "@/rules/text";
import { assembleReport, resolveLinks } from "@/scan/assemble";
import { demoPhoto } from "./photos";
import { platformFixture, type DemoPlatform } from "./platforms";

export type { DemoPlatform };

const SHOP = "https://shop.northwind.example/grid";
const LOOKBOOK = "https://shop.northwind.example/fall-lookbook";
const OLD_POST = "https://blog.northwind.example/old";
const LINEN = "https://northwind.example/journal/linen";
const SIGNED_MEDIA =
  "https://northwind-media.s3.amazonaws.com/palette.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=abc123";

function hoursFrom(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function image(source: string, width: number, height: number, altText: string | null): Asset {
  return { type: "image", source, thumbnail: null, mimeType: "image/jpeg", altText, width, height };
}

function channel(
  id: string,
  service: Service,
  name: string,
  flags: Partial<Pick<Channel, "isDisconnected" | "isLocked" | "isQueuePaused">> = {},
): Channel {
  return {
    id,
    name,
    displayName: name,
    service,
    isDisconnected: flags.isDisconnected ?? false,
    isLocked: flags.isLocked ?? false,
    isQueuePaused: flags.isQueuePaused ?? false,
    timezone: "Europe/Amsterdam",
    maxCharacters: null,
    twitterSubscription: service === "twitter" ? "free" : null,
  };
}

function post(partial: Pick<Post, "id" | "text" | "channelId" | "service" | "dueAt"> & Partial<Post>): Post {
  return {
    status: "scheduled",
    schedulingType: "automatic",
    errorMessage: null,
    assets: [],
    postType: "post",
    firstComment: null,
    hasFirstCommentField: false,
    links: [],
    title: null,
    topic: null,
    thread: [],
    ...partial,
  };
}

function overLimitLinkedIn(): string {
  const unit = `${mathBold("The linen drop ships Friday. ")} ${LINEN} `;
  let text = "";
  while (linkedInLength(text) <= 3000) text += unit;
  return text;
}

export const DEMO_CHANNELS: Channel[] = [
  channel("ch_ig", "instagram", "Northwind on Instagram"),
  channel("ch_li", "linkedin", "Northwind Studio"),
  channel("ch_tw", "twitter", "Northwind on X"),
  channel("ch_fb", "facebook", "Northwind Journal", { isQueuePaused: true }),
  channel("ch_th", "threads", "Northwind on Threads"),
  channel("ch_pin", "pinterest", "Northwind Pins"),
  channel("ch_bs", "bluesky", "Northwind on Bluesky"),
];

export function demoPosts(now: Date): Post[] {
  const shared = "The linen series is back in the studio this week. Same cloth, new dye lot.";
  return [
    post({
      id: "post_ig_comments",
      channelId: "ch_ig",
      service: "instagram",
      dueAt: hoursFrom(now, 20),
      text: "New dye, same cloth. Link in the comments.",
      hasFirstCommentField: true,
      firstComment: "",
      links: [SHOP],
      assets: [image("https://cdn.northwind.example/dye.jpg", 1080, 1920, null)],
    }),
    post({
      id: "post_ig_hem",
      channelId: "ch_ig",
      service: "instagram",
      dueAt: hoursFrom(now, 50),
      text: "Detail of the hem stitch from yesterday's batch.",
      hasFirstCommentField: true,
      firstComment: "Shop the series.",
      assets: [image("https://cdn.northwind.example/hem.jpg", 1080, 1350, "")],
    }),
    post({
      id: "post_li_long",
      channelId: "ch_li",
      service: "linkedin",
      dueAt: hoursFrom(now, 30),
      text: overLimitLinkedIn(),
      hasFirstCommentField: true,
      firstComment: "Full notes are on the journal.",
    }),
    post({
      id: "post_li_dup",
      channelId: "ch_li",
      service: "linkedin",
      dueAt: hoursFrom(now, 26),
      text: shared,
      hasFirstCommentField: true,
      firstComment: "",
    }),
    post({
      id: "post_tw_dup",
      channelId: "ch_tw",
      service: "twitter",
      dueAt: hoursFrom(now, 26.5),
      text: `${shared} ${LINEN}`,
    }),
    post({
      id: "post_tw_lookbook",
      channelId: "ch_tw",
      service: "twitter",
      dueAt: hoursFrom(now, 36),
      text: `The lookbook link is still the old one ${LOOKBOOK}`,
    }),
    post({
      id: "post_tw_todo",
      channelId: "ch_tw",
      service: "twitter",
      dueAt: hoursFrom(now, 70),
      text: `TODO replace this caption before Friday ${OLD_POST}`,
    }),
    post({
      id: "post_tw_overdue",
      channelId: "ch_tw",
      service: "twitter",
      dueAt: hoursFrom(now, -2),
      text: "Studio hours reminder for the team.",
    }),
    post({
      id: "post_fb_paused",
      channelId: "ch_fb",
      service: "facebook",
      dueAt: hoursFrom(now, 40),
      text: "This week's journal is the dye notes.",
      hasFirstCommentField: true,
      firstComment: "",
    }),
    post({
      id: "post_pin_signed",
      channelId: "ch_pin",
      service: "pinterest",
      dueAt: hoursFrom(now, 60),
      text: "Pinning the new palette.",
      title: "Linen palette",
      links: [LINEN],
      assets: [image(SIGNED_MEDIA, 1000, 1500, "Folded linen in walnut dye")],
    }),
    post({
      id: "post_th_topic",
      channelId: "ch_th",
      service: "threads",
      dueAt: hoursFrom(now, 15),
      text: "A short note from the dye room.",
      topic: "spring & summer.",
    }),
    post({
      id: "post_bs_clean",
      channelId: "ch_bs",
      service: "bluesky",
      dueAt: hoursFrom(now, 10),
      text: "Studio hours this Thursday, 10 to 4. Come see the linen series.",
    }),
    post({
      id: "post_li_approval_soon",
      channelId: "ch_li",
      service: "linkedin",
      status: "needs_approval",
      dueAt: hoursFrom(now, 5),
      text: "The linen notes are ready. This still needs a yes before it can go out.",
    }),
    post({
      id: "post_bs_approval_later",
      channelId: "ch_bs",
      service: "bluesky",
      status: "needs_approval",
      dueAt: hoursFrom(now, 72),
      text: "A studio visit next week, once this post is approved.",
    }),
    post({
      id: "post_ig_draft",
      channelId: "ch_ig",
      service: "instagram",
      status: "draft",
      dueAt: null,
      text: "TODO finish this draft before it is scheduled.",
      hasFirstCommentField: true,
      firstComment: "",
      assets: [image("https://cdn.northwind.example/draft.jpg", 1080, 1920, null)],
    }),
  ];
}

function dead(url: string): LinkStatus {
  return { url, outcome: "dead", status: 404, hops: 0, finalUrl: url, detail: "HTTP 404." };
}

function ok(url: string): LinkStatus {
  return { url, outcome: "ok", status: 200, hops: 0, finalUrl: url, detail: "HTTP 200." };
}

export function demoLinkPreset(): Map<string, LinkStatus> {
  return new Map<string, LinkStatus>([
    [SHOP, dead(SHOP)],
    [LOOKBOOK, dead(LOOKBOOK)],
    [OLD_POST, dead(OLD_POST)],
    [LINEN, ok(LINEN)],
    ["https://cdn.northwind.example/dye.jpg", ok("https://cdn.northwind.example/dye.jpg")],
    ["https://cdn.northwind.example/hem.jpg", ok("https://cdn.northwind.example/hem.jpg")],
    ["https://cdn.northwind.example/draft.jpg", ok("https://cdn.northwind.example/draft.jpg")],
  ]);
}

export const DEMO_SUGGESTIONS = [
  {
    postId: "post_ig_comments",
    altText: "Folded linen in a new walnut dye, stacked on a studio table.",
    mismatch: "The caption promises a link in the comments, and the picture is only the cloth.",
  },
  {
    postId: "post_ig_hem",
    altText: "Close-up of a hem stitch on walnut-dyed linen.",
    mismatch: null,
  },
  {
    postId: "post_ig_draft",
    altText: "Unfinished stack of walnut-dyed linen on the studio table.",
    mismatch: "The caption is still a TODO, so it does not describe the cloth.",
  },
];

export async function buildDemoReport(
  now = new Date(),
  windowDays = 7,
  includeDrafts = false,
  platform: DemoPlatform = "all",
): Promise<ScanReport> {
  const start = now.getTime() - 24 * 60 * 60 * 1000;
  const end = now.getTime() + windowDays * 24 * 60 * 60 * 1000;
  const selected = platform === "all" ? null : platformFixture(platform, now);
  const posts = (selected?.posts ?? demoPosts(now)).filter((post) => {
    if ((post.status === "draft" || post.status === "sending") && !includeDrafts) return false;
    if (!post.dueAt) return true;
    const due = new Date(post.dueAt).getTime();
    return due >= start && due <= end;
  });
  const { results, skipped } = await resolveLinks(posts, {
    preset: selected?.links ?? demoLinkPreset(),
    fetchImpl: demoFetch,
    limit: 40,
  });
  const report = assembleReport({
    posts,
    channels: selected?.channels ?? DEMO_CHANNELS,
    linkResults: results,
    now,
    windowDays,
    mode: "demo",
    organization: selected?.organization ?? { id: "org_northwind", name: "Northwind Studio" },
    quotaWindows: [],
    requestsUsed: 0,
    cached: false,
    skippedLinks: skipped,
    includeDrafts,
    suggestions: selected ? [] : DEMO_SUGGESTIONS,
    notes: [
      "Demo mode replays a fixture queue. No Buffer API calls are made.",
      selected
        ? selected.note
        : includeDrafts
          ? "Drafts are included. The unfinished Instagram draft is not scheduled yet."
          : "Drafts are hidden. Turn on Include drafts to check a post before it is scheduled.",
      "Alt-text suggestions in this demo are recorded examples. Nothing is sent to a model.",
      "Pictures on the cards are files shipped with this app. The checks still use the fixture addresses, including the signed image that is meant to expire.",
      selected
        ? "Switch the example at the top to see another platform, or All for the mixed queue."
        : "The broken posts are invented: a dead shop link, a lookbook 404, an old blog 404, a signed S3 image, a paused Facebook queue, a caption that promises a first comment, a LinkedIn post written in Unicode bold, and a post that still needs approval before a slot in the next few hours.",
    ],
  });
  report.cards = report.cards.map((card) => ({
    ...card,
    media: card.media.map((thumb) => ({ ...thumb, src: demoPhoto(thumb.src) })),
    preview: card.preview?.src ? { ...card.preview, src: demoPhoto(card.preview.src) } : card.preview,
  }));
  // The mixed queue leads with the dead shop link, then the TODO. A single platform keeps publish order.
  if (!selected) {
    const lead = ["post_ig_comments", "post_tw_todo"];
    report.cards.sort((a, b) => {
      const ai = lead.indexOf(a.id);
      const bi = lead.indexOf(b.id);
      const ar = ai === -1 ? lead.length : ai;
      const br = bi === -1 ? lead.length : bi;
      if (ar !== br) return ar - br;
      return (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
    });
  }
  return report;
}

const demoFetch: typeof fetch = async () => {
  throw new Error("Demo mode must not perform HTTP checks. Add the URL to the fixture preset.");
};
