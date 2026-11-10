import { mediaUrls } from "@/domain/urls";
import type { Finding } from "@/domain/types";
import { staticUrlRisk } from "@/links/risk";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

export function mediaRule(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    for (const url of mediaUrls(post)) {
      const risk = staticUrlRisk(url);
      if (risk) {
        findings.push(
          makeFinding(ctx, {
            ruleId: "media-url",
            severity: "blocker",
            title: risk.kind === "expiring" ? "Media URL will expire" : "Media URL is not publicly fetchable",
            detail: `${url} — ${risk.reason}`,
            post,
            channelId: post.channelId,
            key: `${risk.kind}:${url}`,
          }),
        );
        continue;
      }
      const status = ctx.linkResults.get(url);
      if (!status || status.outcome === "ok") continue;
      if (status.outcome === "dead") {
        findings.push(
          makeFinding(ctx, {
            ruleId: "media-url",
            severity: "blocker",
            title: "Media URL is not reachable",
            detail: `${url} — ${status.detail} Buffer downloads media when the post publishes.`,
            post,
            channelId: post.channelId,
            key: `dead:${url}`,
          }),
        );
      } else if (status.outcome === "unverified") {
        findings.push(
          makeFinding(ctx, {
            ruleId: "media-url",
            severity: "low",
            title: "Media URL could not be verified",
            detail: `${url} — ${status.detail}`,
            post,
            channelId: post.channelId,
            key: `unverified:${url}`,
          }),
        );
      } else if (status.outcome === "insecure" || status.outcome === "redirect" || status.outcome === "soft-404") {
        findings.push(
          makeFinding(ctx, {
            ruleId: "media-url",
            severity: "medium",
            title: "Media URL looks unstable",
            detail: `${url} — ${status.detail}`,
            post,
            channelId: post.channelId,
            key: `${status.outcome}:${url}`,
          }),
        );
      }
    }
  }
  return findings;
}
