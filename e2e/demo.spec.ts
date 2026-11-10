import { expect, test } from "@playwright/test";

test("demo mode shows the queue health report", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Valid when queued. Broken at publish." })).toBeVisible();
  await page.getByRole("link", { name: "Try the demo queue" }).click();

  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
  const summary = page.getByTestId("summary");
  await expect(summary).toContainText("3 dead links");
  await expect(summary).toContainText("1 duplicate");
  await expect(summary).toContainText("2 missing alt text");
  await expect(summary).toContainText("1 paused channel");
  await expect(page.getByTestId("quota")).toContainText("Demo mode");

  const fix = page.getByRole("link", { name: "Fix in Buffer" }).first();
  await expect(fix).toHaveAttribute("href", /https:\/\/publish\.buffer\.com\/channels\//);

  await page.getByRole("button", { name: /^High/ }).click();
  await expect(page.getByRole("heading", { name: /^High/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Blocker/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Fix in Buffer" }).first()).toBeVisible();

  await page.getByRole("button", { name: "All" }).click();
  await expect(page.getByRole("heading", { name: /^Blocker/ })).toBeVisible();

  await page.getByRole("link", { name: "3 days" }).click();
  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
  await expect(page.getByTestId("summary")).toBeVisible();
});

test("privacy page states the read-only scopes", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "What PostGuard stores" })).toBeVisible();
  await expect(page.getByText("account:read")).toBeVisible();
  await expect(page.getByText("offline_access")).toBeVisible();
});
