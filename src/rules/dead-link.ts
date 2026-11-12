import { copyUrls, extractUrls } from "@/domain/urls";
import type { Finding, LinkOutcome, Severity } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

const SEVERITY: Partial<Record<LinkOutcome, Severity>> = {
  dead: "blocker",
  expiring: "blocker",
  "private-host": "blocker",
  redirect: "medium",
  "soft-404": "medium",
  insecure: "medium",
  unverified: "low",
};

const TITLE: Partial<Record<LinkOutcome, string>> = {
  dead: "Dead link",
  expiring: "Link will expire before publish",
  "private-host": "Link is not a public file",
  redirect: "Long redirect chain",
  "soft-404": "Link redirects to the homepage",
  insecure: "Link is not https",
  unverified: "Link could not be verified",
};

export function deadLinks(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    // A URL that only appears in the first comment is reported by the first-comment rule. Reporting it here as well counts one problem twice.
    const commentOnly = new Set(post.hasFirstCommentField ? extractUrls(post.firstComment) : []);
    for (const url of extractUrls(post.text)) commentOnly.delete(url);
    for (const item of post.thread) for (const url of extractUrls(item.text)) commentOnly.delete(url);
    for (const url of post.links) commentOnly.delete(url);
    for (const url of copyUrls(post)) {
      if (commentOnly.has(url)) continue;
      const status = ctx.linkResults.get(url);
      if (!status || status.outcome === "ok") continue;
      const severity = SEVERITY[status.outcome];
      const title = TITLE[status.outcome];
      if (!severity || !title) continue;
      findings.push(
        makeFinding(ctx, {
          ruleId: "dead-link",
          severity,
          title,
          detail: `${url} — ${status.detail}`,
          post,
          channelId: post.channelId,
          key: `${status.outcome}:${url}`,
        }),
      );
    }
  }
  return findings;
}
