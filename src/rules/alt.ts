import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { excerpt, makeFinding } from "./context";

const GENERIC = new Set(["image", "img", "photo", "picture", "graphic", "pic", "thumbnail"]);
const FILENAME = /\.(jpe?g|png|gif|webp|heic|avif)$/i;

export function altText(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    post.assets.forEach((asset, index) => {
      if (asset.type !== "image") return;
      const alt = (asset.altText ?? "").trim();
      if (!alt) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "alt-text",
            severity: "medium",
            title: "Image is missing alt text",
            detail: "ImageMetadata.altText is empty. The image will publish with no text alternative.",
            post,
            channelId: post.channelId,
            key: `missing-${index}`,
          }),
        );
        return;
      }
      const lowered = alt.toLowerCase();
      const looksLikeFilename = FILENAME.test(alt) || /^(img|dsc|screenshot)[-_]?\d+/i.test(alt);
      const looksGeneric = GENERIC.has(lowered);
      const copiesCaption = lowered === post.text.trim().toLowerCase() && alt.length > 12;
      if (looksLikeFilename || looksGeneric || copiesCaption) {
        const why = looksLikeFilename
          ? "it looks like a filename"
          : looksGeneric
            ? `“${alt}” does not describe the image`
            : "it is a copy of the caption";
        findings.push(
          makeFinding(ctx, {
            ruleId: "weak-alt",
            severity: "low",
            title: "Alt text will not help anyone",
            detail: `Alt text is “${excerpt(alt, 80)}”, and ${why}.`,
            post,
            channelId: post.channelId,
            key: `weak-${index}`,
          }),
        );
      }
    });

    const videos = post.assets.filter((asset) => asset.type === "video");
    if (videos.length > 0 && post.text.trim().length < 40) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "video-alt",
          severity: "info",
          title: "Video has no alt text field",
          detail:
            "VideoMetadata exposes width, height, and duration, and no alt text. The caption is very short, so someone who cannot watch the video gets almost nothing. This is a schema gap, not a value we can read.",
          post,
          channelId: post.channelId,
          key: "video",
          advisory: true,
        }),
      );
    }
  }
  return findings;
}
