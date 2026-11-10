import type { Finding } from "@/domain/types";
import type { RuleContext } from "./context";
import { makeFinding } from "./context";

const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bTODO\b/i, label: "TODO" },
  { re: /\bTBD\b/i, label: "TBD" },
  { re: /\bFIXME\b/i, label: "FIXME" },
  { re: /lorem ipsum/i, label: "lorem ipsum" },
  { re: /\[link\]/i, label: "[link]" },
  { re: /\{\{[^}]+\}\}/, label: "an unfilled {{template}}" },
  { re: /<name>/i, label: "<name>" },
  { re: /\bXXX+\b/, label: "XXX" },
];

export function placeholders(ctx: RuleContext): Finding[] {
  const findings: Finding[] = [];
  for (const post of ctx.posts) {
    const hits = PATTERNS.filter((pattern) => pattern.re.test(post.text)).map((pattern) => pattern.label);
    if (hits.length === 0) continue;
    findings.push(
      makeFinding(ctx, {
        ruleId: "placeholder",
        severity: "high",
        title: "Placeholder text is still in the post",
        detail: `Found ${hits.join(", ")}. It was fine as a draft and it will publish as-is.`,
        post,
        channelId: post.channelId,
        key: hits.join("|"),
      }),
    );
  }
  return findings;
}
