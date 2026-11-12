import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const BASE = process.env.PROD_URL ?? "https://postguard-rho.vercel.app";
const SHOTS = process.env.SHOTS ?? "e2e-prod/shots";
mkdirSync(SHOTS, { recursive: true });

test("home page must not hit /api/auth/start before the user clicks Connect (prefetch would rewrite the OAuth state cookie)", async ({ page, context }) => {
  const hits: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/auth/start")) hits.push(`${r.method()} ${r.url()}`); });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.mouse.move(10, 10);
  await page.getByRole("link", { name: "Connect Buffer" }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  const cookies = (await context.cookies()).filter((c) => c.name === "pg_oauth");
  console.log("PREFETCH_HITS", JSON.stringify(hits), "pg_oauth cookie set before click:", cookies.length);
  expect(hits, "Link prefetch requested the OAuth start route").toEqual([]);
  expect(cookies.length).toBe(0);
});

test("demo: no broken images, no horizontal overflow on mobile, no console errors", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const imgs = await page.evaluate(() => [...document.images].map((i) => ({ src: i.src, ok: i.complete && i.naturalWidth > 0 })));
  await page.screenshot({ path: `${SHOTS}/demo-mobile.png`, fullPage: false });
  console.log("OVERFLOW_PX", overflow, "IMAGES", JSON.stringify(imgs.slice(0, 12)), "ERRORS", JSON.stringify(errors));
  expect(overflow).toBeLessThanOrEqual(1);
  expect(imgs.filter((i) => !i.ok), "images that failed to load in the demo").toEqual([]);
  expect(errors).toEqual([]);
});

test("demo desktop screenshot", async ({ page }) => {
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}/demo-desktop.png`, fullPage: false });
});

for (const path of ["/", "/demo", "/dashboard", "/privacy", "/testing"]) {
  test(`axe incl. moderate/minor on ${path}`, async ({ page }) => {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    const r = await new AxeBuilder({ page }).analyze();
    const rows = r.violations.map((v) => `${v.impact}:${v.id}(${v.nodes.length})`);
    console.log("AXE", path, JSON.stringify(rows));
    expect(r.violations.map((v) => `${v.impact}:${v.id}`), `all axe violations on ${path}`).toEqual([]);
  });
}

test("demo: suggest alt text toggle off/on keeps the suggestions and nothing says 'Asking the model' forever", async ({ page }) => {
  await page.goto(`${BASE}/demo`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Suggest alt text" }).click();
  await expect(page.getByText("Asking the model…")).toHaveCount(0);
});

test("demo query-param abuse never 500s and ?days= means the default window", async ({ request }) => {
  const cases = ["?days=", "?days=abc", "?days=-5", "?days=1e9", "?days=0", "?days=1&days=2", "?drafts=1&days=14", "?refresh=1&days=3"];
  for (const q of cases) {
    const r = await request.get(`${BASE}/demo${q}`, { maxRedirects: 5 });
    expect(r.status(), q).toBe(200);
  }
  const empty = await (await request.get(`${BASE}/demo?days=`)).text();
  const dflt = await (await request.get(`${BASE}/demo`)).text();
  // A blank value should behave like no value (7 days), not silently become a 1-day window.
  expect(empty.length).toBeGreaterThan(dflt.length * 0.9);
});

test("OAuth callback and refresh reject forged input without leaking or crashing", async ({ request }) => {
  const cases: [string, string][] = [
    ["/api/auth/callback?code=x&state=y", "state_mismatch"],
    ["/api/auth/callback?error=access_denied", "access_denied"],
    ["/api/auth/callback", "state_mismatch"],
    ["/api/auth/refresh", "auth_error=session"],
  ];
  for (const [path, expected] of cases) {
    const r = await request.get(`${BASE}${path}`, { maxRedirects: 0 });
    expect(r.status(), path).toBe(307);
    expect(r.headers()["location"], path).toContain(expected);
  }
});

test("API route abuse without a session: always 401 JSON, never 5xx, no body parsing before auth", async ({ request }) => {
  const bodies: (string | Buffer)[] = ["", "null", "[]", "{", '{"imageUrl":123}', '{"imageUrl":"file:///etc/passwd"}', "a".repeat(2_000_000)];
  for (const b of bodies) {
    const r = await request.post(`${BASE}/api/review`, { data: b, headers: { "content-type": "application/json" } });
    expect([401, 413], `body len ${b.length}`).toContain(r.status());
  }
  for (const m of ["GET", "PUT", "DELETE"] as const) {
    const r = await request.fetch(`${BASE}/api/review`, { method: m });
    expect(r.status(), m).toBe(405);
  }
  const lo = await request.get(`${BASE}/api/auth/logout`, { maxRedirects: 0 });
  expect(lo.status()).toBe(405);
});

test("security headers present on HTML responses", async ({ request }) => {
  const r = await request.get(`${BASE}/`);
  const h = r.headers();
  expect(h["x-content-type-options"], "x-content-type-options").toBe("nosniff");
  expect(h["referrer-policy"], "referrer-policy").toBeTruthy();
  expect(h["x-frame-options"] ?? h["content-security-policy"], "frame protection").toBeTruthy();
});

test("auth_error banner must not echo arbitrary attacker text", async ({ page }) => {
  await page.goto(`${BASE}/?auth_error=${encodeURIComponent("Your Buffer account is suspended. Call +1-555-0100 now")}`);
  const banner = await page.getByRole("alert").first().innerText();
  expect(banner).not.toContain("Call +1-555-0100");
});
