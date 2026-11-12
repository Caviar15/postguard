import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => {
      if (value === "") jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));

process.env.SESSION_SECRET = "alerts-route-test-secret-xxxxxxxxxxxxxxxx";
process.env.BUFFER_CLIENT_ID = "client";

import { GET as cronGET } from "@/app/api/cron/check/route";
import { GET as startGET } from "@/app/api/auth/start/route";
import { GET as callbackGET } from "@/app/api/auth/callback/route";
import { readOauthHandoff, readWatchGrant, writeOauthHandoff } from "@/auth/session";

const ORIGIN = "https://postguard.test";

beforeEach(() => {
  jar.clear();
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/check", () => {
  it("answers 401 without the bearer secret, whether or not CRON_SECRET is set", async () => {
    expect((await cronGET(new Request(`${ORIGIN}/api/cron/check`))).status).toBe(401);
    process.env.CRON_SECRET = "s3cret-for-route-test";
    expect((await cronGET(new Request(`${ORIGIN}/api/cron/check`))).status).toBe(401);
    expect((await cronGET(new Request(`${ORIGIN}/api/cron/check`, { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
  });

  it("answers JSON with the right secret (demo source, dry run)", async () => {
    process.env.CRON_SECRET = "s3cret-for-route-test";
    const res = await cronGET(
      new Request(`${ORIGIN}/api/cron/check?source=demo&dryRun=1`, { headers: { authorization: "Bearer s3cret-for-route-test" } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true, sent: false, reason: "dry_run" });
  });
});

describe("watch-mode sign-in", () => {
  it("/api/auth/start?watch=1 marks the handoff, a normal start does not", async () => {
    await startGET(new Request(`${ORIGIN}/api/auth/start?watch=1`));
    expect((await readOauthHandoff())?.watch).toBe(true);
    jar.clear();
    await startGET(new Request(`${ORIGIN}/api/auth/start`));
    expect((await readOauthHandoff())?.watch).toBe(false);
  });

  it("a watch callback keeps the grant for the setup page and does NOT create a browser session", async () => {
    await writeOauthHandoff({ state: "st", verifier: "v", watch: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT-watch", expires_in: 3600 }), { status: 200 }),
    );
    const res = await callbackGET(new Request(`${ORIGIN}/api/auth/callback?code=abc&state=st`));
    fetchSpy.mockRestore();
    expect(new URL(res.headers.get("location")!).pathname).toBe("/alerts/setup");
    expect(jar.has("pg_sess_0")).toBe(false);
    expect((await readWatchGrant())?.refreshToken).toBe("RT-watch");
    expect(jar.get("pg_watch")).not.toContain("RT-watch");
  });
});
