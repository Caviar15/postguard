import { expect, test } from "@playwright/test";

test("switching the example queue keeps the platform in the URL", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("link", { name: "All", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("summary")).toContainText("3 dead links");

  await page.getByRole("link", { name: "TikTok", exact: true }).click();
  await expect(page).toHaveURL(/platform=tiktok/);
  await expect(page.getByRole("link", { name: "TikTok", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("TikTok post has no video")).toBeVisible();
  await expect(page.locator(".service-mark", { hasText: "TT" }).first()).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/platform=tiktok/);
  await expect(page.getByRole("link", { name: "TikTok", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("TikTok post has no video")).toBeVisible();

  await page.getByRole("link", { name: "X", exact: true }).click();
  await expect(page).toHaveURL(/platform=x/);
  await expect(page.getByRole("heading", { name: "Over the character limit" })).toBeVisible();

  await page.getByRole("link", { name: "All", exact: true }).click();
  await expect(page).not.toHaveURL(/platform=/);
  await expect(page.getByTestId("summary")).toContainText("3 dead links");
});
