import { expect, test, type Page } from "@playwright/test";

const order = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll(".post-list article")].map((a) => a.id));
const firstPriority = async (path: string, request: Parameters<Parameters<typeof test>[2]>[0]["request"]) =>
  /<article[^>]*data-priority="(\w+)"/.exec(await (await request.get(path)).text())?.[1];

test("?sort=time is in the server HTML (no flash of Priority order); junk values fall back to Priority", async ({ request }) => {
  expect(await firstPriority("/demo", request)).toBe("blocker");
  expect(await firstPriority("/demo?sort=bogus", request)).toBe("blocker");
  const timeFirst = await firstPriority("/demo?sort=time", request);
  expect(timeFirst).toBeTruthy();
  expect(timeFirst).not.toBe("blocker");
});

test("the chosen sort survives a window change, a reload and Scan again, with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/demo");
  await page.getByRole("button", { name: "Publish time" }).click();
  const byTime = await order(page);
  await page.getByRole("link", { name: "14 days" }).click();
  await expect(page).toHaveURL(/days=14/);
  await expect(page).toHaveURL(/sort=time/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Publish time" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "7 days" }).click();
  await expect(page).toHaveURL(/sort=time/);
  expect(await order(page)).toEqual(byTime);
  await page.getByRole("link", { name: "Scan again" }).click();
  await expect(page.getByRole("button", { name: "Publish time" })).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/sort=time/);
  await expect(page).not.toHaveURL(/refresh=1/);
  await page.getByRole("button", { name: "Priority", exact: true }).click();
  await expect(page).not.toHaveURL(/sort=/);
  expect(errors).toEqual([]);
});
