import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BufferAuthError } from "@/buffer/client";
import { FakeRedis } from "./fake-redis";
import { authorizeOwner, decideOwner, isSameOrigin, type OwnerDeps, type OwnerRecord } from "./owner";
import { RedisAlertStore, type StoredSubscriber } from "./redis";

const AARON = "689720e49043ae8b5d3de907";
const OTHER = "someone-else";
const tokens = { accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 3_600_000, scope: "" };

function record(over: Partial<StoredSubscriber> = {}): StoredSubscriber {
  return { id: "owner", unsubscribeToken: "u", unsubscribed: false, refreshToken: "RT", accessToken: "AT", expiresAt: 1, enabledAt: "2026-11-13T00:00:00Z", ...over };
}

describe("decideOwner", () => {
  it("a grant with a saved account id: only that account, and the setting does not override it", () => {
    expect(decideOwner(AARON, record({ accountId: AARON }), {})).toEqual({ owner: true, claim: false });
    expect(decideOwner(OTHER, record({ accountId: AARON }), {})).toEqual({ owner: false, claim: false });
    expect(decideOwner(OTHER, record({ accountId: AARON }), { ALERT_OWNER_BUFFER_ACCOUNT_ID: OTHER }).owner).toBe(false);
  });

  it("the id stays the owner after alerts are turned off", () => {
    const off = record({ accountId: AARON, unsubscribed: true, refreshToken: null, accessToken: null });
    expect(decideOwner(OTHER, off, {}).owner).toBe(false);
    expect(decideOwner(AARON, off, {}).owner).toBe(true);
  });

  it("an existing grant without a saved id falls back to the setting", () => {
    const env = { ALERT_OWNER_BUFFER_ACCOUNT_ID: ` ${AARON} ` };
    expect(decideOwner(AARON, record(), env).owner).toBe(true);
    expect(decideOwner(OTHER, record(), env).owner).toBe(false);
  });

  it("a working grant with no saved id and no setting has no known owner: nobody passes", () => {
    expect(decideOwner(AARON, record(), {})).toEqual({ owner: false, claim: false });
    expect(decideOwner(AARON, "unreadable", {})).toEqual({ owner: false, claim: false });
  });

  it("no grant: the setting wins, else the first signed-in account claims it", () => {
    for (const none of [null, record({ unsubscribed: true, refreshToken: null })] as OwnerRecord[]) {
      expect(decideOwner(OTHER, none, { ALERT_OWNER_BUFFER_ACCOUNT_ID: AARON }).owner).toBe(false);
      expect(decideOwner(AARON, none, { ALERT_OWNER_BUFFER_ACCOUNT_ID: AARON })).toEqual({ owner: true, claim: false });
      expect(decideOwner(OTHER, none, {})).toEqual({ owner: true, claim: true });
    }
  });

  it("an empty setting is not a setting", () => {
    expect(decideOwner(OTHER, null, { ALERT_OWNER_BUFFER_ACCOUNT_ID: "  " }).claim).toBe(true);
  });
});

describe("authorizeOwner", () => {
  function deps(over: Partial<OwnerDeps> = {}, saved: StoredSubscriber | null = null): OwnerDeps {
    return {
      readSession: async () => ({ accessToken: "AT", refreshToken: "RT", expiresAt: Date.now() + 3_600_000, scope: "" }),
      accountIdFor: async () => AARON,
      store: { readSubscriber: async () => saved },
      storeConfigured: true,
      env: {},
      now: Date.now,
      ...over,
    };
  }

  it("no session, or an expired one without a refresh token: signed out", async () => {
    expect(await authorizeOwner(deps({ readSession: async () => null }))).toEqual({ status: "signed-out" });
    expect(await authorizeOwner(deps({ readSession: async () => ({ accessToken: "AT", refreshToken: null, expiresAt: 1, scope: "" }) }))).toEqual({ status: "signed-out" });
  });

  it("an expiring session with a refresh token asks for a refresh, without calling Buffer", async () => {
    let called = false;
    const result = await authorizeOwner(
      deps({ readSession: async () => ({ accessToken: "AT", refreshToken: "RT", expiresAt: 1, scope: "" }), accountIdFor: async () => ((called = true), AARON) }),
    );
    expect(result).toEqual({ status: "refresh" });
    expect(called).toBe(false);
  });

  it("Buffer rejecting the token is signed out; an outage or a missing id is unavailable, never 'owner'", async () => {
    expect((await authorizeOwner(deps({ accountIdFor: async () => { throw new BufferAuthError(); } }))).status).toBe("signed-out");
    expect((await authorizeOwner(deps({ accountIdFor: async () => { throw new Error("down"); } }))).status).toBe("unavailable");
    expect((await authorizeOwner(deps({ accountIdFor: async () => null }))).status).toBe("unavailable");
  });

  it("an unreachable store, or no store, is unavailable", async () => {
    expect((await authorizeOwner(deps({ store: { readSubscriber: async () => { throw new Error("redis down"); } } }))).status).toBe("unavailable");
    expect((await authorizeOwner(deps({ storeConfigured: false }))).status).toBe("unavailable");
  });

  it("the saved owner passes, anyone else does not", async () => {
    expect(await authorizeOwner(deps({}, record({ accountId: AARON })))).toEqual({ status: "owner", accountId: AARON, claim: false });
    expect(await authorizeOwner(deps({ accountIdFor: async () => OTHER }, record({ accountId: AARON })))).toEqual({ status: "not-owner" });
  });

  it("Aron's existing grant (saved before the id was stored) is recognised only through the setting", async () => {
    const before = record();
    expect((await authorizeOwner(deps({}, before))).status).toBe("not-owner");
    expect(await authorizeOwner(deps({ env: { ALERT_OWNER_BUFFER_ACCOUNT_ID: AARON } }, before))).toEqual({ status: "owner", accountId: AARON, claim: false });
  });
});

describe("isSameOrigin", () => {
  const req = (headers: Record<string, string>, url = "https://postguard.test/api/alerts/enable") => new Request(url, { method: "POST", headers });
  it("accepts the site's own Origin, behind a proxy too", () => {
    expect(isSameOrigin(req({ origin: "https://postguard.test" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://postguard.test", "x-forwarded-host": "postguard.test, internal" }, "http://localhost:3000/x"))).toBe(true);
    expect(isSameOrigin(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("refuses another site, a null origin, a different host and a request that says nothing", () => {
    expect(isSameOrigin(req({ origin: "https://evil.example" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "null" }))).toBe(false);
    expect(isSameOrigin(req({ origin: "https://postguard.test", host: "evil.example" }))).toBe(false);
    expect(isSameOrigin(req({}))).toBe(false);
    expect(isSameOrigin(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(req({ "sec-fetch-site": "same-site" }))).toBe(false);
  });
});

describe("the store keeps the owner id", () => {
  const store = () => new RedisAlertStore(new FakeRedis(), "owner-test-secret-xxxxxxxxxxxxxxxxxxxx", () => ({ email: "a@b.c", timeZone: null }));
  it("enable saves it, turn-off and unsubscribe keep it while wiping the tokens, a refresh keeps it", async () => {
    const s = store();
    await s.enable(tokens, new Date(), AARON);
    expect((await s.readSubscriber())?.accountId).toBe(AARON);
    await s.writeGrant("owner", { refreshToken: "RT2", accessToken: "AT2", expiresAt: 5 });
    expect((await s.readSubscriber())?.accountId).toBe(AARON);
    await s.disable();
    const off = await s.readSubscriber();
    expect(off).toMatchObject({ accountId: AARON, refreshToken: null, accessToken: null, unsubscribed: true });
    await s.enable(tokens, new Date(), AARON);
    const [owner] = await s.listSubscribers();
    expect(await s.unsubscribe(owner!.unsubscribeToken)).toBe(true);
    expect((await s.readSubscriber())?.accountId).toBe(AARON);
  });
  it("an enable without an id (older callers) leaves none", async () => {
    const s = store();
    await s.enable(tokens);
    expect((await s.readSubscriber())?.accountId).toBeUndefined();
  });
});

describe("the setup page and the links to it", () => {
  const page = readFileSync("src/app/alerts/setup/page.tsx", "utf8");
  it("has no setup-code or password input, and shows the switch and the demo button", () => {
    expect(page).not.toMatch(/type="password"/);
    expect(page).not.toMatch(/name="code"/);
    expect(page).not.toMatch(/Setup code/i);
    expect(page).toContain('role="switch"');
    expect(page).toContain("Send test alert now");
    expect(page).toMatch(/DEMO-ONLY/);
  });
  it("the home page and the dashboard link to it as 'Email alerts'", () => {
    for (const file of ["src/app/page.tsx", "src/components/Dashboard.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toMatch(/href="\/alerts\/setup">Email alerts</);
    }
  });
  it("asks for no scope beyond account:read, posts:read and offline_access", () => {
    const oauth = readFileSync("src/auth/oauth.ts", "utf8");
    expect(oauth).toMatch(/account:read posts:read offline_access/);
  });
});
