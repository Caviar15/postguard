import { expect, test } from "@playwright/test";

test("a paused-queue card never says High and 'No problems on this post' at once", async ({ page }) => {
  await page.goto("/demo");
  const card = page.locator("#post-post_fb_paused");
  await expect(card).toHaveAttribute("data-priority", "high");
  await expect(card).not.toContainText("No problems on this post");
  await expect(card).toContainText("Queue is paused");
  await page.getByRole("button", { name: /^High/ }).click();
  await expect(card).toBeVisible();
  const shown = await page.locator(".post-list article").count();
  await expect(page.getByRole("button", { name: new RegExp(`^High \\(${shown}\\)`) })).toBeVisible();
  await expect(page.locator(".stats .priority-high")).toContainText(String(shown));
});
