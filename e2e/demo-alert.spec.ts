import { expect, test } from "@playwright/test";

test("the demo links to an alert email preview that is clearly sample data", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: "Preview alert email" }).click();
  await expect(page).toHaveURL(/\/demo\/alert$/);
  await expect(page.getByRole("heading", { name: "It comes to you." })).toBeVisible();
  await expect(page.getByTestId("alert-subject")).toContainText("PostGuard:");
  const body = page.getByTestId("alert-body");
  await expect(body).toContainText("Preview with sample data");
  await expect(body.getByRole("link", { name: "Fix in Buffer" }).first()).toBeVisible();
  await expect(body.getByRole("link", { name: "Open PostGuard" })).toHaveAttribute("href", "/demo");
  await expect(body).toContainText("Blocker");
  // Only Blocker and High problems are in the email.
  await expect(body).not.toContainText("Medium");
});

test("the alert preview follows ?platform= and keeps it when switching", async ({ page }) => {
  await page.goto("/demo?platform=tiktok");
  await page.getByRole("link", { name: "Preview alert email" }).click();
  await expect(page).toHaveURL(/\/demo\/alert\?platform=tiktok/);
  await expect(page.getByRole("link", { name: "TikTok", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("alert-body")).toContainText("TikTok");
  await page.getByRole("link", { name: "X", exact: true }).click();
  await expect(page).toHaveURL(/platform=x/);
  await expect(page.getByTestId("alert-body")).toContainText("Northwind on X");
  await page.getByRole("link", { name: "Back to the demo queue" }).click();
  await expect(page).toHaveURL(/\/demo\?platform=x/);
});

for (const width of [1280, 375]) {
  test(`the alert preview does not overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/demo/alert");
    await expect(page.getByTestId("alert-body")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const frame = await page.getByTestId("alert-preview").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(frame.scroll).toBeLessThanOrEqual(frame.client);
  });
}

test("the cron endpoint is closed without the secret", async ({ request }) => {
  const res = await request.get("/api/cron/check");
  expect(res.status()).toBe(401);
});

test("alert setup page explains the one-time sign-in and shows no token by itself", async ({ page }) => {
  await page.goto("/alerts/setup");
  await expect(page.getByRole("heading", { name: "Alerts that come to you." })).toBeVisible();
  await expect(page.getByTestId("token-value")).toHaveCount(0);
});
