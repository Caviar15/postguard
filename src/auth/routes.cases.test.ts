/**
 * Route-level tests: call the real Next route handlers with a faked cookie jar.
 * Drop into src/critical/routes.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => { if (value === "") jar.delete(name); else jar.set(name, value); },
  }),
}));

process.env.SESSION_SECRET = "route-test-secret-long-enough-xxxxxxxxxxxx";
process.env.BUFFER_CLIENT_ID = "client";

import { writeSession, writeOauthHandoff } from "@/auth/session";
import { GET as refreshGET } from "@/app/api/auth/refresh/route";
import { GET as callbackGET } from "@/app/api/auth/callback/route";
import { POST as reviewPOST } from "@/app/api/review/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { writeCachedReport, cacheKey } from "@/scan/cache";
import type { ScanReport } from "@/domain/types";

const ORIGIN = "https://postguard.test";
const liveSession = { accessToken: "AT-1", refreshToken: null, expiresAt: Date.now() + 3_600_000, scope: "posts:read" };

beforeEach(() => jar.clear());

describe("/api/auth/refresh ?next= must stay on this origin", () => {
  const hostile = ["/\\evil.example", "/\\/evil.example", "/\t/evil.example", "/%09/evil.example", "//evil.example", "https://evil.example", "/\n/evil.example", "/ /evil.example"];
  for (const next of hostile) {
    it(`never redirects off-site for next=${JSON.stringify(next)}`, async () => {
      await writeSession(liveSession); // a still-valid session redirects straight to `next`
      const res = await refreshGET(new Request(`${ORIGIN}/api/auth/refresh?next=${encodeURIComponent(next)}`));
      const location = res.headers.get("location") ?? "";
      expect(new URL(location, ORIGIN).origin, `Location: ${location}`).toBe(ORIGIN);
    });
  }
  it("a normal in-app path still works", async () => {
    await writeSession(liveSession);
    const res = await refreshGET(new Request(`${ORIGIN}/api/auth/refresh?next=${encodeURIComponent("/dashboard?days=14&drafts=1")}`));
    expect(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search).toBe("/dashboard?days=14&drafts=1");
  });
});

describe("/api/auth/callback", () => {
  it("refuses a callback whose state does not match the cookie, and burns the handoff", async () => {
    await writeOauthHandoff({ state: "good-state", verifier: "v" });
    const res = await callbackGET(new Request(`${ORIGIN}/api/auth/callback?code=abc&state=attacker-state`));
    expect(res.headers.get("location")).toContain("state_mismatch");
    // the one-time handoff must be gone: replaying with the right state afterwards must still fail
    const replay = await callbackGET(new Request(`${ORIGIN}/api/auth/callback?code=abc&state=good-state`));
    expect(replay.headers.get("location")).toContain("state_mismatch");
  });
  it("refuses a callback with no handoff cookie at all (login CSRF)", async () => {
    const res = await callbackGET(new Request(`${ORIGIN}/api/auth/callback?code=abc&state=anything`));
    expect(res.headers.get("location")).toContain("state_mismatch");
    expect(jar.has("pg_sess_0")).toBe(false);
  });
  it("never reflects arbitrary provider error text into the redirect URL unencoded", async () => {
    const res = await callbackGET(new Request(`${ORIGIN}/api/auth/callback?error=${encodeURIComponent("x&evil=1#frag")}`));
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("evil")).toBeNull();
    expect(location.origin).toBe(ORIGIN);
  });
});

describe("/api/review", () => {
  const post = (body: unknown, raw = false) =>
    reviewPOST(new Request(`${ORIGIN}/api/review`, { method: "POST", headers: { "content-type": "application/json" }, body: raw ? (body as string) : JSON.stringify(body) }));

  it("401 without a session, before reading the body", async () => {
    expect((await post({ imageUrl: "http://169.254.169.254/" })).status).toBe(401);
  });
  it("400 for non-JSON, wrong types, non-http schemes and URLs that are not in the cached scan", async () => {
    await writeSession(liveSession);
    for (const body of ["{", "null", "[]", '{"imageUrl":42}', '{"imageUrl":"file:///etc/passwd"}', '{"imageUrl":"http://169.254.169.254/latest"}', '{"imageUrl":"https://cdn.example/not-in-scan.jpg"}']) {
      const res = await post(body, true);
      expect(res.status, body).toBe(400);
    }
  });
  it("a URL that IS in this session's cached scan reaches the model path (positive control, model unavailable offline)", async () => {
    await writeSession(liveSession);
    const report = { cards: [{ preview: { src: "https://cdn.example/a.jpg" } }] } as unknown as ScanReport;
    writeCachedReport(cacheKey("AT-1", "default", 7, false), report);
    const res = await post({ imageUrl: "https://cdn.example/a.jpg", caption: "x", service: "instagram" });
    expect(res.status).toBe(200); // ok:false/unavailable is fine; it must not be a 400/500
  });
  it("a different session cannot use another session's cached image", async () => {
    writeCachedReport(cacheKey("AT-1", "default", 7, false), { cards: [{ preview: { src: "https://cdn.example/a.jpg" } }] } as unknown as ScanReport);
    await writeSession({ ...liveSession, accessToken: "AT-2" });
    expect((await post({ imageUrl: "https://cdn.example/a.jpg" })).status).toBe(400);
  });
  it("an expired session gets 401, not a scan", async () => {
    await writeSession({ ...liveSession, expiresAt: Date.now() - 1000 });
    expect((await post({ imageUrl: "https://cdn.example/a.jpg" })).status).toBe(401);
  });
});

describe("/api/auth/logout", () => {
  it("clears every session cookie chunk", async () => {
    await writeSession(liveSession);
    expect(jar.has("pg_sess_0")).toBe(true);
    const res = await logoutPOST(new Request(`${ORIGIN}/api/auth/logout`, { method: "POST" }));
    expect(res.status).toBe(303);
    expect([...jar.keys()].filter((k) => k.startsWith("pg_sess"))).toEqual([]);
  });
});
