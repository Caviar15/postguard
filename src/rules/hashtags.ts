import { urlPattern } from "@/domain/urls";
import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

const HASHTAG = /(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu;

/** Instagram's caption cap, as Buffer documents it. The composer blocks a post above this. */
const INSTAGRAM_HASHTAG_CAP =
  "Instagram caps hashtags at 5 per caption. Buffer's composer blocks publishing above 5.";

function tagCount(text: string): number {
  const prose = text.replace(urlPattern(), " ");
  return prose.match(HASHTAG)?.length ?? 0;
}

export function hashtags(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    const prose = post.text.replace(urlPattern(), " ");
    if (post.service === "instagram") {
      const captionTags = tagCount(post.text);
      if (captionTags > 5) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "hashtags",
            severity: "high",
            title: "More than 5 hashtags",
            detail: `${captionTags} hashtags in the caption. ${INSTAGRAM_HASHTAG_CAP}`,
            post,
            channelId: post.channelId,
            key: "count",
            advisory: false,
          }),
        );
      }
      const comment = post.hasFirstCommentField ? (post.firstComment ?? "") : "";
      const commentTags = comment ? tagCount(comment) : 0;
      if (commentTags > 5) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "hashtags",
            severity: "high",
            title: "More than 5 hashtags",
            detail: `${commentTags} hashtags in the first comment. ${INSTAGRAM_HASHTAG_CAP}`,
            post,
            channelId: post.channelId,
            key: "count-comment",
            advisory: false,
          }),
        );
      }
    }
    // A lone "#" that stands on its own. "C#" and "F#" have a letter in front of the sign.
    if (/(^|\s)#(\s|$)/.test(prose)) {
      findings.push(
        makeFinding(ctx, {
          ruleId: "hashtags",
          severity: "low",
          title: "Broken hashtag",
          detail: "A # is followed by a space or ends the post, so it will not become a tag.",
          post,
          channelId: post.channelId,
          key: "broken",
        }),
      );
    }
  }
  return findings;
}
