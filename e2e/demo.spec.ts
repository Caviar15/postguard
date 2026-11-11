import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("demo mode shows the queue health report", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Valid when queued. Broken at publish." })).toBeVisible();
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
  await expect(page.getByText(/hatched area is what gets cut off/i).first()).toBeVisible();

  const fix = page.getByRole("link", { name: "Fix in Buffer" }).first();
  await expect(fix).toHaveAttribute("href", /https:\/\/publish\.buffer\.com\/channels\//);

  await page.getByRole("button", { name: /^High/ }).click();
  await expect(page.getByRole("heading", { name: "Publish time has passed" })).toBeVisible();
  await expect(page.locator(".post-list").getByText("The lookbook link is still the old one")).toHaveCount(0);

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
  await expect(page.getByText("account:read")).toBeVisible();
  await expect(page.getByText("offline_access", { exact: true })).toBeVisible();
});

for (const path of ["/", "/demo", "/privacy", "/testing"]) {
  test(`no serious accessibility violations on ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
}
