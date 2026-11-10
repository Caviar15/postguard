import type { Finding, Severity } from "./types";

function count(findings: Finding[], ruleId: string, severity?: Severity): number {
  return findings.filter((finding) => finding.ruleId === ruleId && (!severity || finding.severity === severity)).length;
}

function phrase(countValue: number, singular: string, plural: string): string {
  return `${countValue} ${countValue === 1 ? singular : plural}`;
}

/** The one-line queue health sentence shown at the top of the report. */
export function headline(findings: Finding[], windowDays: number): string {
  const parts: string[] = [];
  const dead = count(findings, "dead-link", "blocker");
  const duplicates = count(findings, "duplicate");
  const alt = count(findings, "alt-text");
  const paused = count(findings, "channel-paused");
  if (dead) parts.push(phrase(dead, "dead link", "dead links"));
  if (duplicates) parts.push(phrase(duplicates, "duplicate", "duplicates"));
  if (alt) parts.push(phrase(alt, "missing alt text", "missing alt text"));
  if (paused) parts.push(phrase(paused, "paused channel", "paused channels"));

  const headlined = new Set(["dead-link", "duplicate", "alt-text", "channel-paused"]);
  const other = findings.filter(
    (finding) => !headlined.has(finding.ruleId) && (finding.severity === "blocker" || finding.severity === "high"),
  ).length;
  if (other) parts.push(phrase(other, "other risk", "other risks"));

  if (parts.length === 0) return `Next ${windowDays} days: nothing in this window looks broken.`;
  return `Next ${windowDays} days: ${parts.join(", ")}.`;
}

export function emptyTotals(): Record<Severity, number> {
  return { blocker: 0, high: 0, medium: 0, low: 0, info: 0 };
}
