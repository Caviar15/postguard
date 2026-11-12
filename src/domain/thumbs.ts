import type { Asset, CardThumb } from "./types";

/** How many pictures a card shows before the rest collapse into “+N”. */
export const MEDIA_STRIP_LIMIT = 3;

export type { CardThumb };

/**
 * Pictures a card can show from assets the scan already has.
 * Images use their source. Videos use the poster, and a video with no poster is skipped
 * so a “no video” finding still has an empty card. Documents are not pictures.
 */
export function cardMedia(assets: Asset[]): { thumbs: CardThumb[]; extra: number } {
  const thumbs: CardThumb[] = [];
  for (const asset of assets) {
    if (asset.type === "image") {
      if (!asset.source) continue;
      thumbs.push({ src: asset.source, alt: asset.altText ?? "", kind: "image" });
    } else if (asset.type === "video") {
      if (!asset.thumbnail) continue;
      thumbs.push({ src: asset.thumbnail, alt: "", kind: "video" });
    }
  }
  if (thumbs.length <= MEDIA_STRIP_LIMIT) return { thumbs, extra: 0 };
  return {
    thumbs: thumbs.slice(0, MEDIA_STRIP_LIMIT),
    extra: thumbs.length - MEDIA_STRIP_LIMIT,
  };
}
