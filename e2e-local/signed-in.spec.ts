import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { expect, test, type BrowserContext } from "@playwright/test";
import { scenarios } from "./scenarios";

const SECRET = "e2e-secret-e2e-secret-e2e-secret-1234";
function sealed(payload: object) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", createHash("sha256").update(SECRET).digest(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(payload), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}
async function signIn(context: BrowserContext, over: object = {}) {
  const s = sealed({ accessToken: `AT-${Math.random()}`, refreshToken: null, expiresAt: Date.now() + 3_600_000, scope: "x", ...over });
  const parts = s.match(/.{1,3000}/g)!;
  const base = { domain: "127.0.0.1", path: "/", httpOnly: true, secure: false, sameSite: "Lax" as const };
  await context.addCookies([{ ...base, name: "pg_sess_n", value: String(parts.length) }, ...parts.map((v, i) => ({ ...base, name: `pg_sess_${i}`, value: v }))]);
}
const scenario = (name: keyof typeof scenarios) => writeFileSync("/tmp/pg-scenario.json", JSON.stringify(scenarios[name]));
const mockCalls = () => readFileSync("/tmp/pg-mock.log", "utf8").trim().split("\n").filter(Boolean).map((l) => l.split(" ")[1]);

test("normal queue renders findings, no console errors", async ({ page, context }) => {
  scenario("normal"); await signIn(context);
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
  await expect(page.getByText("Placeholder text is still in the post")).toBeVisible();
  await expect(page.getByText("Image is missing alt text")).toBeVisible();
  expect(errors).toEqual([]);
});

test("empty queue shows the empty state and a sensible timeline", async ({ page, context }) => {
  scenario("empty"); await signIn(context);
  await page.goto("/dashboard");
  await expect(page.getByText("Nothing is queued in this window.")).toBeVisible();
  await expect(page.getByTestId("timeline")).toBeVisible();
});

test("channel timezone the API gives us is garbage: dashboard must still render", async ({ page, context }) => {
  scenario("badTimezone"); await signIn(context);
  const res = await page.goto("/dashboard");
  expect(res?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
});

test("650 long posts: renders within 20s and the page stays usable", async ({ page, context }) => {
  scenario("huge"); await signIn(context);
  const t0 = Date.now();
  const res = await page.goto("/dashboard", { timeout: 60_000 });
  const took = Date.now() - t0;
  console.log("HUGE_QUEUE_MS", took, "status", res?.status(), "calls", mockCalls().length);
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
  expect(took).toBeLessThan(20_000);
});

test("Buffer 429: friendly error, not a crash", async ({ page, context }) => {
  scenario("rateLimited"); await signIn(context);
  const res = await page.goto("/dashboard");
  expect(res?.status()).toBe(200);
  await expect(page.getByText("The live queue could not be read.")).toBeVisible();
  await expect(page.locator("p.banner")).toContainText("rate limit");
});

test("Buffer 401 without a refresh token asks to reconnect", async ({ page, context }) => {
  scenario("authRejected"); await signIn(context);
  await page.goto("/dashboard");
  await expect(page.getByText("Connect Buffer again.")).toBeVisible();
});

test("a post with null text is not silently dropped from the count", async ({ page, context }) => {
  scenario("nullText"); await signIn(context);
  await page.goto("/dashboard");
  const posts = await page.locator(".stats .stat", { hasText: "posts" }).innerText();
  // 3 posts came back from Buffer. An unreadable one must be reported, not vanish.
  const noted = await page.locator(".notes").innerText().catch(() => "");
  expect(posts.startsWith("3") || /could not (be )?read|left out|skipped|unreadable/i.test(noted), `${posts} / notes: ${noted}`).toBe(true);
});

test("an image with no known dimensions never leaves 'Asking the model…' on screen", async ({ page, context }) => {
  scenario("noDimensions"); await signIn(context);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Suggest alt text" }).click();
  await page.waitForTimeout(3000);
  await expect(page.getByText("Asking the model…")).toHaveCount(0);
});

test("Scan again twice in a row must not spend a second full scan inside 30 seconds", async ({ page, context }) => {
  scenario("normal"); await signIn(context);
  await page.goto("/dashboard");
  const before = mockCalls().length;
  await page.getByRole("link", { name: "Scan again" }).click();
  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
  await page.getByRole("link", { name: "Scan again" }).click();
  await expect(page.getByRole("heading", { name: "Queue health" })).toBeVisible();
  const spent = mockCalls().length - before;
  console.log("API_CALLS_FOR_TWO_RESCANS", spent);
  expect(spent, "two rapid rescans each cost a full set of Buffer requests").toBeLessThanOrEqual(5);
});

// Known limitation, not a regression: only the first organization is scanned and there is no switcher. The scan says so in a note.
test.fixme("the second org is reachable (account has 2 organizations)", async ({ page, context }) => {
  scenario("twoOrgs"); await signIn(context);
  await page.goto("/dashboard");
  await expect(page.getByText(/2 organizations/)).toBeVisible();
  // The note admits only one org is scanned. There is no switcher, so Org Two is unreachable from the UI.
  await expect(page.getByRole("link", { name: /Org Two/ }).or(page.getByRole("combobox"))).toBeVisible();
});

test("tampered session cookie lands on the connect prompt, never a 500", async ({ page, context }) => {
  scenario("normal");
  await context.addCookies([{ domain: "127.0.0.1", path: "/", name: "pg_sess_n", value: "1" }, { domain: "127.0.0.1", path: "/", name: "pg_sess_0", value: "AAAA.BBBB.CCCC" }]);
  const res = await page.goto("/dashboard");
  expect(res?.status()).toBe(200);
  await expect(page.getByText("Not connected")).toBeVisible();
});

test("dashboard query abuse stays 200", async ({ page, context }) => {
  scenario("normal"); await signIn(context);
  for (const q of ["?days=", "?days=abc", "?days=999", "?org=%00", "?org=a&org=b", "?refresh=1&drafts=1&days=14", "?days=7&retried=1"]) {
    const res = await page.goto(`/dashboard${q}`);
    expect(res, `${q} returned no document response`).toBeTruthy();
    expect(res!.status(), q).toBeLessThan(500);
    await expect(page.getByText("Internal Server Error"), q).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /Queue health|Connect Buffer/ }), q).toBeVisible();
  }
});
