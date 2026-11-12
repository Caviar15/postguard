/**
 * Route-level tests: call the real Next route handlers with a faked cookie jar.
 * Drop into src/critical/ai-budget.test.ts.
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

describe("/api/review AI spend", () => {
  const post = (body: unknown) =>
    reviewPOST(new Request(`${ORIGIN}/api/review`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  it("AI spend is capped across reconnects: 60 fresh sign-ins x 1 request must not all reach the model", async () => {
    // Each new sign-in gets a new access token, hence a new per-session budget key.
    // A global ceiling must stop the Nth request. We count how many reach the model path.
    let reachedModel = 0;
    for (let i = 0; i < 60; i += 1) {
      jar.clear();
      const token = `AT-bulk-${i}`;
      await writeSession({ ...liveSession, accessToken: token });
      writeCachedReport(cacheKey(token, "default", 7, false), { cards: [{ preview: { src: `https://cdn.example/${i}.jpg` } }] } as unknown as ScanReport);
      const res = await post({ imageUrl: `https://cdn.example/${i}.jpg` });
      const body = (await res.json()) as { reason?: string };
      if (body.reason !== "capped") reachedModel += 1;
    }
    expect(reachedModel).toBeLessThanOrEqual(40);
  }, 60_000);
});
