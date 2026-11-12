import { expect, test, type Locator } from "@playwright/test";

test("demo cards show the picture for each platform that has media", async ({ page }) => {
  await page.goto("/demo");
  await expect(page.getByTestId("summary")).toContainText("3 dead links");
  await expect(page.getByTestId("summary")).toContainText("8 other risks");
  const dye = page.locator("#post-post_ig_comments .media-frame img");
  await expect(dye).toHaveAttribute("src", "/demo/dye.jpg");
  await expect(dye).toHaveAttribute("alt", "");
  await expect(dye).toHaveAttribute("loading", "lazy");
  await expect(page.locator("#post-post_pin_signed .media-frame img")).toHaveAttribute("src", "/demo/palette.jpg");
  await expectLoaded(page.locator(".media-frame img"));

  await page.goto("/demo?platform=instagram");
  await expect(page.locator("#post-ig_alt .media-frame img")).toHaveAttribute("alt", "");
  const ready = page.locator("#post-ig_ready .media-frame img");
  await expect(ready).toHaveCount(2);
  await expect(ready.nth(0)).toHaveAttribute("alt", "Folded walnut-dyed linen on a studio table");
  await expect(ready.nth(1)).toHaveAttribute("alt", "Close view of the walnut dye along the hem");
  await expect(page.locator("#post-ig_dead .media-frame")).toHaveCount(0);
  await expectLoaded(page.locator(".media-frame img"));

  await page.goto("/demo?platform=tiktok");
  await expect(page.locator("#post-tt_novideo .media-frame")).toHaveCount(0);
  await expect(page.locator("#post-tt_ready .play-badge")).toBeVisible();
  await expect(page.locator("#post-tt_ready .media-frame img")).toHaveAttribute("src", "/demo/tiktok-ready.jpg");
  await expect(page.locator(".media-frame img")).toHaveCount(5);
  await expectLoaded(page.locator(".media-frame img"));

  await page.goto("/demo?platform=x");
  const xPhoto = page.locator("#post-x_ready .media-frame img");
  await expect(xPhoto).toHaveAttribute("src", "/demo/x-ready.jpg");
  await expect(xPhoto).toHaveAttribute("alt", "Linen shirts on a rack in the studio");
  await expect(page.locator(".media-frame")).toHaveCount(1);
  await expectLoaded(xPhoto);

  await page.goto("/demo?platform=linkedin");
  await expect(page.locator("#post-li_alt .media-frame img")).toHaveAttribute("src", "/demo/li-desk.jpg");
  await expect(page.locator("#post-li_alt .media-frame img")).toHaveAttribute("alt", "");
  await expect(page.locator(".media-frame")).toHaveCount(1);

  await page.goto("/demo?platform=facebook");
  await expect(page.locator("#post-fb_alt .media-frame img")).toHaveAttribute("alt", "");
  await expect(page.locator("#post-fb_weak .media-frame img")).toHaveAttribute("alt", "image");
  await expect(page.locator("#post-fb_ready .media-frame")).toHaveCount(0);
  await expectLoaded(page.locator(".media-frame img"));

  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/demo?platform=instagram");
  const overflow = await page.locator(".post-card").evaluateAll((nodes) =>
    nodes.some((node) => node.scrollWidth > node.clientWidth + 1),
  );
  expect(overflow).toBe(false);
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBe(0);
});

async function expectLoaded(images: Locator) {
  const count = await images.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    await expect.poll(async () => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
}
