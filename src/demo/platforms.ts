import type { Asset, Channel, LinkStatus, Post, Service } from "@/domain/types";
import { mathBold } from "@/rules/text";

export const DEMO_PLATFORMS = ["all", "instagram", "tiktok", "x", "linkedin", "facebook"] as const;
export type DemoPlatform = (typeof DEMO_PLATFORMS)[number];

export function parseDemoPlatform(value: string | undefined): DemoPlatform {
  if (value === "twitter") return "x";
  if (value && (DEMO_PLATFORMS as readonly string[]).includes(value)) return value as DemoPlatform;
  return "all";
}

export function platformLabel(platform: DemoPlatform): string {
  switch (platform) {
    case "instagram":
      return "Instagram";
    case "tiktok":
      return "TikTok";
    case "x":
      return "X";
    case "linkedin":
      return "LinkedIn";
    case "facebook":
      return "Facebook";
    default:
      return "All";
  }
}

function hoursFrom(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function image(source: string, width: number, height: number, altText: string | null): Asset {
  return { type: "image", source, thumbnail: null, mimeType: "image/jpeg", altText, width, height };
}

function video(source: string, poster: string, width: number, height: number): Asset {
  return { type: "video", source, thumbnail: poster, mimeType: "video/mp4", altText: null, width, height };
}

function channel(id: string, service: Service, name: string): Channel {
  return {
    id,
    name,
    displayName: name,
    service,
    isDisconnected: false,
    isLocked: false,
    isQueuePaused: false,
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

function dead(url: string): LinkStatus {
  return { url, outcome: "dead", status: 404, hops: 0, finalUrl: url, detail: "HTTP 404." };
}

function ok(url: string): LinkStatus {
  return { url, outcome: "ok", status: 200, hops: 0, finalUrl: url, detail: "HTTP 200." };
}

function insecure(url: string): LinkStatus {
  return { url, outcome: "insecure", status: 200, hops: 0, finalUrl: url, detail: "The link uses http." };
}

const SHOP = "https://shop.northwind.example/grid";
const TIKTOK_DEAD = "https://shop.northwind.example/tiktok-drop";
const TIKTOK_CLIP = "https://cdn.northwind.example/tiktok-clip.mp4";
const TIKTOK_POSTER = "https://cdn.northwind.example/tiktok-clip.jpg";
const TIKTOK_WIDE = "https://cdn.northwind.example/tiktok-wide.mp4";
const TIKTOK_WIDE_POSTER = "https://cdn.northwind.example/tiktok-wide.jpg";
const TIKTOK_OK = "https://cdn.northwind.example/tiktok-ok.mp4";
const TIKTOK_OK_POSTER = "https://cdn.northwind.example/tiktok-ok.jpg";
const TIKTOK_READY = "https://cdn.northwind.example/tiktok-ready.mp4";
const TIKTOK_READY_POSTER = "https://cdn.northwind.example/tiktok-ready.jpg";
const TIKTOK_LOW = "https://cdn.northwind.example/tiktok-low.mp4";
const TIKTOK_LOW_POSTER = "https://cdn.northwind.example/tiktok-low.jpg";
const FB_DEAD = "https://shop.northwind.example/journal";
const FB_PHOTO = "https://cdn.northwind.example/fb-photo.jpg";
const FB_WEAK = "https://cdn.northwind.example/fb-weak.jpg";
const IG_ALT = "https://cdn.northwind.example/ig-square.jpg";
const IG_READY = "https://cdn.northwind.example/ig-ready.jpg";
const LI_ALT = "https://cdn.northwind.example/li-desk.jpg";

export type PlatformFixture = {
  organization: { id: string; name: string };
  channels: Channel[];
  posts: Post[];
  links: Map<string, LinkStatus>;
  note: string;
};

function repeatTo(seed: string, length: number): string {
  let text = "";
  while (text.length < length) text += seed;
  return text.slice(0, length);
}

export function platformFixture(platform: Exclude<DemoPlatform, "all">, now: Date): PlatformFixture {
  switch (platform) {
    case "instagram":
      return instagram(now);
    case "tiktok":
      return tiktok(now);
    case "x":
      return x(now);
    case "linkedin":
      return linkedin(now);
    case "facebook":
      return facebook(now);
  }
}

function instagram(now: Date): PlatformFixture {
  const id = "ch_ig_only";
  return {
    organization: { id: "org_northwind", name: "Northwind Studio" },
    channels: [channel(id, "instagram", "Northwind on Instagram")],
    note: "Instagram example: a dead shop link, six hashtags, a photo with no alt text, and a broken hash.",
    links: new Map([
      [SHOP, dead(SHOP)],
      [IG_ALT, ok(IG_ALT)],
      [IG_READY, ok(IG_READY)],
    ]),
    posts: [
      post({
        id: "ig_dead",
        channelId: id,
        service: "instagram",
        dueAt: hoursFrom(now, 20),
        text: `The grid is up, if the link still works ${SHOP}`,
      }),
      post({
        id: "ig_tags",
        channelId: id,
        service: "instagram",
        dueAt: hoursFrom(now, 30),
        text: "New dye lot #linen #walnut #studio #cloth #dye #northwind",
      }),
      post({
        id: "ig_alt",
        channelId: id,
        service: "instagram",
        dueAt: hoursFrom(now, 50),
        text: "A square still from the dye room, before the caption was finished.",
        assets: [image(IG_ALT, 1080, 1080, null)],
      }),
      post({
        id: "ig_hash",
        channelId: id,
        service: "instagram",
        dueAt: hoursFrom(now, 8),
        text: "Big news # coming from the studio this afternoon.",
      }),
      post({
        id: "ig_ready",
        channelId: id,
        service: "instagram",
        dueAt: hoursFrom(now, 70),
        text: "Open studio Thursday, 10 to 4. The linen series is on the table.",
        assets: [image(IG_READY, 1080, 1080, "Folded walnut-dyed linen on a studio table")],
      }),
      post({
        id: "ig_note",
        channelId: id,
        service: "instagram",
        dueAt: hoursFrom(now, 96),
        text: "The cloth dried evenly. Nothing else to add.",
      }),
    ],
  };
}

function tiktok(now: Date): PlatformFixture {
  const id = "ch_tt";
  return {
    organization: { id: "org_northwind", name: "Northwind Studio" },
    channels: [channel(id, "tiktok", "Northwind on TikTok")],
    note: "TikTok example: a dead link on a vertical clip, a post with no video, a landscape clip, and a plain http link.",
    links: new Map([
      [TIKTOK_DEAD, dead(TIKTOK_DEAD)],
      [TIKTOK_CLIP, ok(TIKTOK_CLIP)],
      [TIKTOK_POSTER, ok(TIKTOK_POSTER)],
      [TIKTOK_WIDE, ok(TIKTOK_WIDE)],
      [TIKTOK_WIDE_POSTER, ok(TIKTOK_WIDE_POSTER)],
      [TIKTOK_OK, ok(TIKTOK_OK)],
      [TIKTOK_OK_POSTER, ok(TIKTOK_OK_POSTER)],
      [TIKTOK_READY, ok(TIKTOK_READY)],
      [TIKTOK_READY_POSTER, ok(TIKTOK_READY_POSTER)],
      [TIKTOK_LOW, ok(TIKTOK_LOW)],
      [TIKTOK_LOW_POSTER, ok(TIKTOK_LOW_POSTER)],
      ["http://notes.northwind.example/dye", insecure("http://notes.northwind.example/dye")],
    ]),
    posts: [
      post({
        id: "tt_dead",
        channelId: id,
        service: "tiktok",
        dueAt: hoursFrom(now, 18),
        text: `The drop clip, and the shop link ${TIKTOK_DEAD}`,
        assets: [video(TIKTOK_CLIP, TIKTOK_POSTER, 1080, 1920)],
      }),
      post({
        id: "tt_novideo",
        channelId: id,
        service: "tiktok",
        dueAt: hoursFrom(now, 28),
        text: "A caption with nowhere for the picture to go.",
      }),
      post({
        id: "tt_wide",
        channelId: id,
        service: "tiktok",
        dueAt: hoursFrom(now, 46),
        text: "Shot sideways in the dye room. It should be vertical.",
        assets: [video(TIKTOK_WIDE, TIKTOK_WIDE_POSTER, 1920, 1080)],
      }),
      post({
        id: "tt_http",
        channelId: id,
        service: "tiktok",
        dueAt: hoursFrom(now, 60),
        text: "Notes from the vat http://notes.northwind.example/dye",
        assets: [video(TIKTOK_OK, TIKTOK_OK_POSTER, 1080, 1920)],
      }),
      post({
        id: "tt_bold",
        channelId: id,
        service: "tiktok",
        dueAt: hoursFrom(now, 12),
        text: `${mathBold("Sale")} on the walnut lot this weekend only.`,
        assets: [video(TIKTOK_LOW, TIKTOK_LOW_POSTER, 1080, 1920)],
      }),
      post({
        id: "tt_ready",
        channelId: id,
        service: "tiktok",
        dueAt: hoursFrom(now, 80),
        text: "Thirty seconds of the cloth coming out of the walnut dye.",
        assets: [video(TIKTOK_READY, TIKTOK_READY_POSTER, 1080, 1920)],
      }),
    ],
  };
}

function x(now: Date): PlatformFixture {
  const id = "ch_x_only";
  return {
    organization: { id: "org_northwind", name: "Northwind Studio" },
    channels: [channel(id, "twitter", "Northwind on X")],
    note: "X example: a post over the free 280 limit, one already overdue, and one within 5% of the limit.",
    links: new Map(),
    posts: [
      post({
        id: "x_over",
        channelId: id,
        service: "twitter",
        dueAt: hoursFrom(now, 22),
        text: repeatTo("The linen series is back in the studio this week. ", 320),
      }),
      post({
        id: "x_overdue",
        channelId: id,
        service: "twitter",
        dueAt: hoursFrom(now, -3),
        text: "Studio hours reminder that never left the queue.",
      }),
      post({
        id: "x_near",
        channelId: id,
        service: "twitter",
        dueAt: hoursFrom(now, 40),
        text: repeatTo("Walnut dye, same cloth, short note. ", 270),
      }),
      post({
        id: "x_bold",
        channelId: id,
        service: "twitter",
        dueAt: hoursFrom(now, 14),
        text: `${mathBold("Sale")} starts Friday in the studio.`,
      }),
      post({
        id: "x_ready",
        channelId: id,
        service: "twitter",
        dueAt: hoursFrom(now, 10),
        text: "Open studio Thursday, 10 to 4.",
      }),
      post({
        id: "x_later",
        channelId: id,
        service: "twitter",
        dueAt: hoursFrom(now, 90),
        text: "The next lot is on the line.",
      }),
    ],
  };
}

function linkedin(now: Date): PlatformFixture {
  const id = "ch_li_only";
  return {
    organization: { id: "org_northwind", name: "Northwind Studio" },
    channels: [channel(id, "linkedin", "Northwind Studio")],
    note: "LinkedIn example: a post over 3,000 characters, one waiting for approval in a few hours, and a photo with no alt text.",
    links: new Map([[LI_ALT, ok(LI_ALT)]]),
    posts: [
      post({
        id: "li_over",
        channelId: id,
        service: "linkedin",
        dueAt: hoursFrom(now, 26),
        text: repeatTo("The studio notes continue with the same cloth and a new dye lot. ", 3100),
      }),
      post({
        id: "li_approval",
        channelId: id,
        service: "linkedin",
        status: "needs_approval",
        dueAt: hoursFrom(now, 5),
        text: "The linen notes are ready. This still needs a yes before it can go out.",
      }),
      post({
        id: "li_alt",
        channelId: id,
        service: "linkedin",
        dueAt: hoursFrom(now, 48),
        text: "A desk photo from the week the walnut lot came off the line.",
        assets: [image(LI_ALT, 1200, 800, "")],
      }),
      post({
        id: "li_bold",
        channelId: id,
        service: "linkedin",
        dueAt: hoursFrom(now, 16),
        text: `${mathBold("Note")} from the dye room: the lot is even.`,
      }),
      post({
        id: "li_later",
        channelId: id,
        service: "linkedin",
        status: "needs_approval",
        dueAt: hoursFrom(now, 72),
        text: "A studio visit next week, once this post is approved.",
      }),
      post({
        id: "li_ready",
        channelId: id,
        service: "linkedin",
        dueAt: hoursFrom(now, 100),
        text: "We are dyeing linen in walnut again. The cloth is the same.",
      }),
    ],
  };
}

function facebook(now: Date): PlatformFixture {
  const id = "ch_fb_only";
  return {
    organization: { id: "org_northwind", name: "Northwind Studio" },
    channels: [channel(id, "facebook", "Northwind Journal")],
    note: "Facebook example: a dead journal link, an empty first comment, a photo with no alt text, and a filename-style alt.",
    links: new Map([
      [FB_DEAD, dead(FB_DEAD)],
      [FB_PHOTO, ok(FB_PHOTO)],
      [FB_WEAK, ok(FB_WEAK)],
    ]),
    posts: [
      post({
        id: "fb_dead",
        channelId: id,
        service: "facebook",
        dueAt: hoursFrom(now, 22),
        text: `This week's journal ${FB_DEAD}`,
        hasFirstCommentField: true,
        firstComment: "More in the piece.",
      }),
      post({
        id: "fb_comment",
        channelId: id,
        service: "facebook",
        dueAt: hoursFrom(now, 34),
        text: "New dye, same cloth. Link in the comments.",
        hasFirstCommentField: true,
        firstComment: "",
      }),
      post({
        id: "fb_alt",
        channelId: id,
        service: "facebook",
        dueAt: hoursFrom(now, 52),
        text: "The cloth on the line behind the studio.",
        hasFirstCommentField: true,
        firstComment: "Taken Thursday.",
        assets: [image(FB_PHOTO, 1200, 900, null)],
      }),
      post({
        id: "fb_weak",
        channelId: id,
        service: "facebook",
        dueAt: hoursFrom(now, 15),
        text: "A closer look at the hem.",
        hasFirstCommentField: true,
        firstComment: "Hem stitch.",
        assets: [image(FB_WEAK, 1200, 900, "image")],
      }),
      post({
        id: "fb_ready",
        channelId: id,
        service: "facebook",
        dueAt: hoursFrom(now, 9),
        text: "Open studio Thursday, 10 to 4. Come see the linen.",
        hasFirstCommentField: true,
        firstComment: "No ticket needed.",
      }),
      post({
        id: "fb_later",
        channelId: id,
        service: "facebook",
        dueAt: hoursFrom(now, 88),
        text: "The next lot goes in the vat on Monday.",
        hasFirstCommentField: true,
        firstComment: "Walnut again.",
      }),
    ],
  };
}
