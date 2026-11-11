import type { Post, Service } from "@/domain/types";

export type RatioBand = { min: number; max: number; label: string };

/**
 * The same bands the aspect-ratio rule uses.
 * Instagram feed 4:5–1.91:1 and story/reel 9:16:
 * https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
 * Pinterest's recommended pin is about 2:3:
 * https://help.pinterest.com/en/business/article/pinterest-product-specs
 */
export function ratioBand(service: Service, postType: string | null, hasVideo: boolean): RatioBand | null {
  const kind = (postType ?? "post").toLowerCase();
  if (service === "instagram") {
    if (kind === "story" || kind === "reel") return { min: 0.5625, max: 0.5625, label: "9:16" };
    return { min: 0.8, max: 1.91, label: "4:5 to 1.91:1" };
  }
  if (service === "tiktok" && hasVideo) return { min: 0.5625, max: 0.5625, label: "9:16" };
  if (service === "pinterest") return { min: 0.5, max: 0.8, label: "around 2:3" };
  return null;
}

export type CropFrame = {
  targetRatio: number;
  label: string;
  cropped: boolean;
  /** Fractions of the image (0–1) that a centered crop would cut off. */
  top: number;
  bottom: number;
  left: number;
  right: number;
};

const TOLERANCE = 0.02;

/** Center-crop geometry for one image. Null when this network has no band, or the size is missing. */
export function cropFrame(width: number, height: number, band: RatioBand | null): CropFrame | null {
  if (!band || !width || !height) return null;
  const ratio = width / height;
  const min = band.min * (1 - TOLERANCE);
  const max = band.max * (1 + TOLERANCE);
  if (ratio >= min && ratio <= max) {
    return { targetRatio: ratio, label: band.label, cropped: false, top: 0, bottom: 0, left: 0, right: 0 };
  }
  const target = ratio < band.min ? band.min : band.max;
  if (ratio < target) {
    const kept = ratio / target;
    const cut = (1 - kept) / 2;
    return { targetRatio: target, label: band.label, cropped: true, top: cut, bottom: cut, left: 0, right: 0 };
  }
  const kept = target / ratio;
  const cut = (1 - kept) / 2;
  return { targetRatio: target, label: band.label, cropped: true, top: 0, bottom: 0, left: cut, right: cut };
}

export function cropForPost(post: Pick<Post, "service" | "postType" | "assets">, index: number): CropFrame | null {
  const asset = post.assets[index];
  if (!asset || (asset.type !== "image" && asset.type !== "video")) return null;
  if (!asset.width || !asset.height) return null;
  const band = ratioBand(post.service, post.postType, post.assets.some((item) => item.type === "video"));
  return cropFrame(asset.width, asset.height, band);
}
