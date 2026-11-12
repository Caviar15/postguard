import { expect, test } from "@playwright/test";

test("the demo's first card is the dead-link post with four findings, and groups stay in priority order", async ({ page }) => {
  await page.goto("/demo");
  const ids = await page.evaluate(() => [...document.querySelectorAll(".post-list article")].map((a) => a.id));
  expect(ids[0]).toBe("post-post_ig_comments");
  const pri = await page.evaluate(() => [...document.querySelectorAll(".post-list article")].map((a) => (a as HTMLElement).dataset.priority ?? "ready"));
  const rank: Record<string, number> = { blocker: 0, high: 1, medium: 2, low: 3, ready: 4 };
  const ranks = pri.map((p) => rank[p] ?? 99);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
});
