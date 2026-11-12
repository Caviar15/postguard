import { describe, expect, it } from "vitest";
import { buildDemoReport } from "@/demo/build";
import { compareByPriority } from "./readiness";

describe("within one priority the post with the most at stake leads", () => {
  it("orders by priority, then risk weight, then time", () => {
    const cards = [
      { id: "light-soon", priority: "blocker" as const, dueAt: "2026-11-12T08:00:00.000Z", risk: 34 },
      { id: "heavy-late", priority: "blocker" as const, dueAt: "2026-11-14T08:00:00.000Z", risk: 78 },
      { id: "mid-soon", priority: "blocker" as const, dueAt: "2026-11-12T09:00:00.000Z", risk: 52 },
      { id: "tie-later", priority: "blocker" as const, dueAt: "2026-11-12T11:00:00.000Z", risk: 52 },
      { id: "high-heavy", priority: "high" as const, dueAt: "2026-11-12T07:00:00.000Z", risk: 90 },
    ];
    expect([...cards].sort(compareByPriority).map((c) => c.id)).toEqual(["heavy-late", "mid-soon", "tie-later", "light-soon", "high-heavy"]);
  });

  it("the assembled demo cards carry a weight: 4-finding dead-link post > 2-finding > 1-finding > clean", async () => {
    const report = await buildDemoReport(new Date("2026-11-10T12:00:00.000Z"), 7);
    const weight = (id: string) => report.cards.find((card) => card.id === id)?.risk ?? 0;
    expect(weight("post_ig_comments")).toBeGreaterThan(weight("post_tw_todo"));
    expect(weight("post_tw_todo")).toBeGreaterThan(weight("post_th_topic"));
    expect(weight("post_bs_clean")).toBe(0);
  });
});
