import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("demo mode shows the queue health report", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Valid when queued. Broken at publish." })).toBeVisible();
  await expect(page.getByText("Not affiliated with or endorsed by Buffer")).toBeVisible();
  await page.getByRole("link", { name: "Try the demo queue" }).click();

  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
  await expect(page.getByTestId("risk")).toContainText("risky");
  const summary = page.getByTestId("summary");
  await expect(summary).toContainText("3 dead links");
  await expect(summary).toContainText("1 duplicate");
  await expect(summary).toContainText("2 missing alt text");
  await expect(summary).toContainText("1 paused channel");
  await expect(page.getByTestId("quota")).toContainText("Demo mode");
  await expect(page.getByTestId("timeline")).toBeVisible();
  await expect(page.getByText("Will fail")).toHaveCount(0);
  await expect(page.getByText("Needs attention")).toHaveCount(0);
  await expect(page.locator(".post-list article").first()).toHaveAttribute("data-priority", "blocker");
  await expect(page.locator(".post-list .priority-ready").first()).toBeVisible();
  await page.getByRole("button", { name: "Publish time" }).click();
  await expect(page).toHaveURL(/sort=time/);
  await expect(page).not.toHaveURL(/refresh=1/);
  await expect(page.locator(".post-list article").first()).not.toHaveAttribute("data-priority", "blocker");
  await page.getByRole("button", { name: "Priority", exact: true }).click();
  await expect(page.locator(".post-list article").first()).toHaveAttribute("data-priority", "blocker");
  await expect(page).not.toHaveURL(/[?&]sort=/);
  await expect(page.getByText(/hatched area is what gets cut off/i).first()).toBeVisible();

  const fix = page.getByRole("link", { name: "Fix in Buffer" }).first();
  await expect(fix).toHaveAttribute("href", /https:\/\/publish\.buffer\.com\/channels\//);

  await expect(page.getByRole("button", { name: /^Info/ })).toHaveCount(0);
  await expect(page.locator(".stats .stat.info")).toHaveCount(0);
  const blockerCount = await page.locator(".post-list article[data-priority='blocker']").count();
  await expect(page.getByRole("button", { name: new RegExp(`^Blocker \\(${blockerCount}\\)`) })).toBeVisible();
  await expect(page.locator(".stats .priority-blocker")).toContainText(String(blockerCount));

  await page.getByRole("button", { name: /^Ready/ }).click();
  await expect(page).toHaveURL(/filter=ready/);
  await expect(page).not.toHaveURL(/refresh=1/);
  const readyCards = page.locator(".post-list article");
  await expect(readyCards.first()).toHaveAttribute("data-priority", "ready");
  const readyPriorities = await readyCards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-priority")));
  expect(readyPriorities.every((priority) => priority === "ready")).toBe(true);
  await page.getByRole("button", { name: "Publish time" }).click();
  await expect(page).toHaveURL(/sort=time/);
  await expect(page).toHaveURL(/filter=ready/);
  await expect(readyCards.first()).toHaveAttribute("data-priority", "ready");

  await page.getByRole("button", { name: "Priority", exact: true }).click();
  await page.getByRole("button", { name: /^High/ }).click();
  await expect(page.getByRole("heading", { name: "Publish time has passed" })).toBeVisible();
  await expect(page.locator(".post-list").getByText("The lookbook link is still the old one")).toHaveCount(0);
  const highPriorities = await page.locator(".post-list article").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-priority")));
  expect(highPriorities.every((priority) => priority === "high")).toBe(true);

  await page.getByRole("button", { name: "All" }).click();
  await expect(page.getByRole("heading", { name: "Dead link" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Suggest alt text" }).click();
  await expect(page.getByText("Folded linen in a new walnut dye, stacked on a studio table.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy alt text" }).first()).toBeVisible();

  await page.getByRole("link", { name: "Include drafts" }).click();
  await expect(page.getByText("Draft", { exact: true }).first()).toBeVisible();
  await expect(page.locator("#post-post_ig_draft").getByRole("heading", { name: "Placeholder text is still in the post" })).toBeVisible();

  await page.getByRole("link", { name: "3 days" }).click();
  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
  await expect(page.getByTestId("summary")).toBeVisible();
});

test("privacy page states the read-only scopes", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "What PostGuard stores" })).toBeVisible();
  await expect(page.getByText("account:read", { exact: true })).toBeVisible();
  await expect(page.getByText("posts:read", { exact: true })).toBeVisible();
  await expect(page.getByText("offline_access")).toHaveCount(0);
});

test("scan again in demo mode stays on a working dashboard", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: "Scan again" }).click();
  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
  await expect(page.getByTestId("summary")).toContainText("dead link");
  await expect(page.getByText("The live queue could not be read.")).toHaveCount(0);
  await expect(page.getByText("Scan stopped")).toHaveCount(0);
  await expect(page).toHaveURL(/\/demo\?days=7$/);
});

for (const path of ["/", "/demo", "/privacy", "/testing"]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
