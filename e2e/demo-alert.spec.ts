import { expect, test } from "@playwright/test";

test("the demo links to an alert email preview that is clearly sample data", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: "Preview alert email" }).click();
  await expect(page).toHaveURL(/\/demo\/alert$/);
  await expect(page.getByRole("heading", { name: "It comes to you." })).toBeVisible();
  await expect(page.getByTestId("alert-subject")).toContainText("PostGuard:");
  const body = page.getByTestId("alert-body");
  await expect(body).toContainText("Preview with sample data");
  await expect(body).toContainText("roughly the next 27 hours");
  await expect(body.getByRole("link", { name: "Fix in Buffer" }).first()).toBeVisible();
  await expect(body.getByRole("link", { name: "See it in PostGuard" }).first()).toHaveAttribute("href", /#post-/);
  await expect(body).toContainText("Blocker");
  await expect(body.getByRole("link", { name: "Stop these emails" })).toBeVisible();
  // Only Blocker and High problems are in the email.
  await expect(body).not.toContainText("Medium");
});

test("the alert preview follows ?platform= and keeps it when switching", async ({ page }) => {
  await page.goto("/demo?platform=instagram");
  await page.getByRole("link", { name: "Preview alert email" }).click();
  await expect(page).toHaveURL(/\/demo\/alert\?platform=instagram/);
  await expect(page.getByRole("link", { name: "Instagram", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("alert-body")).toContainText("Instagram");
  await page.getByRole("link", { name: "Back to the demo queue" }).click();
  await expect(page).toHaveURL(/\/demo\?platform=instagram/);
});

test("a queue with nothing risky in the next 27 hours says no email would be sent", async ({ page }) => {
  const platforms = ["tiktok", "x", "linkedin", "facebook"];
  for (const platform of platforms) {
    await page.goto(`/demo/alert?platform=${platform}`);
    const empty = await page.getByTestId("alert-empty").count();
    const preview = await page.getByTestId("alert-preview").count();
    expect(empty + preview, platform).toBe(1);
    if (empty) {
      await expect(page.getByTestId("alert-empty")).toContainText("No email would be sent");
    }
  }
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

test("the cron endpoint and the unsubscribe link are closed to strangers", async ({ request }) => {
  expect([401, 500]).toContain((await request.get("/api/cron/alerts")).status());
  const unsub = await request.get("/api/alerts/unsubscribe?token=bogus");
  expect(unsub.status()).toBeLessThan(500);
  expect(await unsub.text()).toContain('method="post"');
});

test("alert setup shows no code box and no token, and no switch to a stranger", async ({ page }) => {
  await page.goto("/alerts/setup");
  await expect(page.getByRole("heading", { name: "Alerts that come to you." })).toBeVisible();
  // Signed out (and, locally, with no Buffer app configured): nothing to type, no switch, no test button.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByLabel(/Setup code/)).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send test alert now" })).toHaveCount(0);
  // It must not say which settings exist: no variable names, no "set / not set" list.
  const text = await page.locator("body").innerText();
  for (const name of ["CRON_SECRET", "RESEND_API_KEY", "ALERT_EMAIL_TO", "ALERT_OWNER", "KV_REST_API", "UPSTASH", "SESSION_SECRET"]) expect(text).not.toContain(name);
  await expect(page.locator("body")).not.toContainText("refresh_token");
});

test("the main page and the dashboard link to the alerts page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Email alerts" }).click();
  await expect(page).toHaveURL(/\/alerts\/setup$/);
  await page.goto("/demo");
  await page.getByRole("link", { name: "Email alerts" }).click();
  await expect(page).toHaveURL(/\/alerts\/setup$/);
});
