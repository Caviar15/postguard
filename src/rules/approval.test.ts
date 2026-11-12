import { describe, expect, it } from "vitest";
import { makeChannel, makePost } from "@/test/factory";
import { runRules } from "./engine";

const NOW = new Date("2026-11-12T12:00:00.000Z");

function approvalFindings(dueAt: string | null) {
  return runRules({
    posts: [makePost({ status: "needs_approval", dueAt, text: "Ready when you are." })],
    channels: [makeChannel()],
    linkResults: new Map(),
    now: NOW,
  }).filter((finding) => finding.ruleId === "needs-approval");
}

describe("needs-approval", () => {
  it("flags a post due in the next 24 hours", () => {
    const findings = approvalFindings("2026-11-12T17:00:00.000Z");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.title).toBe("Waiting for approval, due in 5h");
    expect(findings[0]?.detail).toBe("Buffer won't publish this post until someone approves it.");
  });

  it("uses overdue wording when the slot has already passed", () => {
    const findings = approvalFindings("2026-11-12T09:00:00.000Z");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toBe("Waiting for approval, 3h overdue");
    expect(findings[0]?.severity).toBe("high");
  });

  it("stays quiet when approval is more than a day away", () => {
    expect(approvalFindings("2026-11-15T12:00:00.000Z")).toHaveLength(0);
  });

  it("stays quiet when there is no publish time", () => {
    expect(approvalFindings(null)).toHaveLength(0);
  });
});
