import type { Channel, Post, Service } from "@/domain/types";
import { blueskyLength, instagramLength, linkedInLength, mastodonLength, utf16Length, xLength } from "./text";

export type CountMethod = "utf16" | "linkedin" | "instagram" | "mastodon" | "x" | "bluesky";

export function countMethod(service: Service): CountMethod | null {
  switch (service) {
    case "linkedin":
      return "linkedin";
    case "instagram":
      return "instagram";
    case "mastodon":
      return "mastodon";
    case "twitter":
      return "x";
    case "bluesky":
      return "bluesky";
    case "facebook":
    case "pinterest":
    case "tiktok":
    case "threads":
    case "youtube":
    case "googlebusiness":
    case "substack":
      return "utf16";
    default:
      return null;
  }
}

export function countText(text: string, method: CountMethod): number {
  switch (method) {
    case "linkedin":
      return linkedInLength(text);
    case "instagram":
      return instagramLength(text);
    case "mastodon":
      return mastodonLength(text);
    case "x":
      return xLength(text);
    case "bluesky":
      return blueskyLength(text);
    case "utf16":
      return utf16Length(text);
  }
}

/**
 * X Free is 280 and Basic/Premium/Premium+ is 25,000.
 * `subscriptionType` is an unstructured string. Empty, "free", and "none"
 * use 280. A value that mentions basic, premium, or plus uses 25,000.
 * Anything else stays on 280 so we don't silently allow an over-long post.
 */
export function xPostLimit(subscription: string | null): { limit: number; assumedFree: boolean } {
  const value = (subscription ?? "").trim().toLowerCase();
  if (!value || value === "none" || value === "free") return { limit: 280, assumedFree: false };
  if (/(basic|premium|plus)/.test(value)) return { limit: 25_000, assumedFree: false };
  return { limit: 280, assumedFree: true };
}

export function postLimit(
  post: Post,
  channel: Channel | undefined,
): { limit: number; method: CountMethod; note: string | null } | null {
  const method = countMethod(post.service);
  if (!method) return null;
  let note: string | null = null;
  let limit: number;
  switch (post.service) {
    case "facebook":
      limit = 5_000;
      break;
    case "instagram":
      limit = 2_196;
      break;
    case "twitter": {
      const x = xPostLimit(channel?.twitterSubscription ?? null);
      limit = x.limit;
      if (x.assumedFree) {
        note = `subscriptionType "${channel?.twitterSubscription}" is not a known X plan, so the free 280 limit was used.`;
      }
      break;
    }
    case "linkedin":
      limit = 3_000;
      break;
    case "pinterest":
      limit = 500;
      break;
    case "tiktok":
      limit = post.assets.some((asset) => asset.type === "video") ? 2_200 : 4_000;
      break;
    case "threads":
      limit = 500;
      break;
    case "bluesky":
      limit = 300;
      break;
    case "youtube":
      limit = 5_000;
      break;
    case "googlebusiness":
      limit = 4_000;
      break;
    case "mastodon":
      limit = Math.min(channel?.maxCharacters ?? 500, 20_000);
      if (!channel?.maxCharacters) note = "Mastodon server limit was missing, so 500 was used.";
      break;
    case "substack":
      limit = 10_000;
      break;
    default:
      return null;
  }
  return { limit, method, note };
}

export function firstCommentLimit(service: Service): { limit: number; method: CountMethod } | null {
  switch (service) {
    case "facebook":
      return { limit: 5_000, method: "utf16" };
    case "instagram":
      return { limit: 2_200, method: "instagram" };
    case "linkedin":
      return { limit: 1_250, method: "linkedin" };
    default:
      return null;
  }
}

export const METHOD_NOTE: Record<CountMethod, string> = {
  utf16: "Counted in UTF-16 code units, which is how Buffer counts this network.",
  linkedin: "Counted in UTF-16 code units, with every URL weighed as 24 characters.",
  instagram: "Counted in UTF-16 code units, with each line break weighed as 2.",
  mastodon: "Counted in UTF-16 code units. URLs weigh 23, and the server part of an @user@server mention is not counted.",
  x: "Counted with X's weights: URLs are 23, and emoji or Unicode bold are 2.",
  bluesky: "Counted in graphemes. A URL counts as its host plus at most 16 more characters.",
};
