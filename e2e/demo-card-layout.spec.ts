import { expect, test, type Page } from "@playwright/test";

test("each post card keeps one picture under its header", async ({ page }) => {
  for (const url of ["/demo?platform=instagram", "/demo"]) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url);
    await expect(page.locator(".crop img, .crop-frame")).toHaveCount(0);
    await checkCards(page, false);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(url);
    await checkCards(page, true);
  }
});

async function checkCards(page: Page, mobile: boolean) {
  const cards = page.locator(".post-list article");
  const count = await cards.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    const header = card.locator("header");
    const title = card.locator("h2");
    const media = card.locator(".media-frame, .media-missing").first();
    await header.scrollIntoViewIfNeeded();
    const headerBox = await header.boundingBox();
    const titleBox = await title.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(headerBox!.y).toBeLessThanOrEqual(titleBox!.y + 1);

    if ((await media.count()) === 0) continue;
    const mediaBox = await media.boundingBox();
    expect(mediaBox).not.toBeNull();
    expect(titleBox!.y + titleBox!.height).toBeLessThanOrEqual(mediaBox!.y + 2);
    expect(mediaBox!.height).toBeLessThanOrEqual(mobile ? 230 : 170);

    const images = await card.locator("img").count();
    const frames = await card.locator(".media-frame").count();
    expect(images).toBe(await card.locator(".media-frame img").count());
    if (frames === 1) expect(images).toBe(1);

    if (!mobile) continue;
    const finding = card.locator(".finding-inline").first();
    if ((await finding.count()) === 0) continue;
    const findingBox = await finding.boundingBox();
    expect(findingBox).not.toBeNull();
    expect(mediaBox!.y + mediaBox!.height).toBeLessThanOrEqual(findingBox!.y + 2);
  }
}
