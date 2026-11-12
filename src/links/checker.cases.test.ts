/** Critical tests: SSRF guard and link checker. Drop into src/critical/links.test.ts */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkMany, checkUrl, clearLinkCache } from "@/links/checker";
import { assertPublicHttpUrl, isBlockedAddress } from "@/links/ssrf";
import type { LinkStatus } from "@/domain/types";
const PUBLIC = async () => ["93.184.216.34"];
const resp = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });

describe("SSRF guard: every way to spell loopback / metadata must be refused", () => {
  const hostile = [
    "http://127.0.0.1/", "http://2130706433/", "http://0x7f.1/", "http://127.1/", "http://0/",
    "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:a9fe:a9fe]/",
    "http://169.254.169.254/latest/meta-data/", "http://[fd00:ec2::254]/", "http://100.100.100.200/",
    "http://10.0.0.1/", "http://172.16.0.1/", "http://192.168.1.1/", "http://127。0。0。1/",
  ];
  for (const url of hostile) {
    it(`refuses ${url}`, async () => {
      await expect(assertPublicHttpUrl(url)).rejects.toThrow();
    });
  }
  it("refuses ports, credentials and non-http schemes", async () => {
    for (const url of ["http://example.com:8080/", "https://example.com:22/", "http://u:p@example.com/", "ftp://example.com/", "file:///etc/passwd", "gopher://x/"]) {
      await expect(assertPublicHttpUrl(url, PUBLIC), url).rejects.toThrow();
    }
  });
  it("refuses a host when ANY of its A/AAAA records is private (mixed answer)", async () => {
    await expect(assertPublicHttpUrl("http://evil.example/", async () => ["93.184.216.34", "10.0.0.5"])).rejects.toThrow();
    await expect(assertPublicHttpUrl("http://evil.example/", async () => ["2606:2800:220:1::1", "::1"])).rejects.toThrow();
  });
  it("a redirect to a private address is never fetched", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return resp(302, { location: "http://169.254.169.254/latest/meta-data/" });
    }) as unknown as typeof fetch;
    const lookup = async (host: string) => (host === "169.254.169.254" ? ["169.254.169.254"] : ["93.184.216.34"]);
    const out = await checkUrl("https://good.example/x", fetchImpl, 1000, lookup);
    expect(calls).toEqual(["https://good.example/x"]);
    expect(out.outcome).toBe("unverified");
  });
  it("blocks IPv4-mapped, loopback and link-local literals directly", () => {
    for (const ip of ["::ffff:7f00:1", "::ffff:127.0.0.1", "::1", "fe80::1", "169.254.169.254", "0.0.0.0", "not-an-ip"]) expect(isBlockedAddress(ip), ip).toBe(true);
    expect(isBlockedAddress("93.184.216.34")).toBe(false);
    expect(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });
});

describe("link checker: classification a social-media queue will hit constantly", () => {
  beforeEach(() => clearLinkCache());
  // A plain object, because `new Response(null, { status: 999 })` throws: 999 is outside the legal range.
  const status = (code: number) => (async () => ({ status: code, headers: new Headers(), body: null })) as unknown as typeof fetch;
  it("a 5xx is an outage, not a dead link: must not be 'dead' (blocker)", async () => {
    for (const code of [500, 502, 503, 504]) {
      const out = await checkUrl("https://news.example/story", status(code), 1000, PUBLIC);
      expect(out.outcome, `HTTP ${code}`).not.toBe("dead");
    }
  });
  it("LinkedIn answers bots with the non-standard 999: must not be 'dead'", async () => {
    const out = await checkUrl("https://www.linkedin.com/company/buffer/", status(999), 1000, PUBLIC);
    expect(out.outcome).not.toBe("dead");
  });
  it("404 and 410 are dead", async () => {
    for (const code of [404, 410]) expect((await checkUrl("https://a.example/x", status(code), 1000, PUBLIC)).outcome).toBe("dead");
  });
  it("a hung host plus a long redirect chain is bounded: one URL may not take > 12s of wall clock", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const slow = (async (_u: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
          n += 1;
          setTimeout(() => resolve(resp(302, { location: `https://a.example/${n}` })), 3_900);
        })) as unknown as typeof fetch;
      const started = Date.now();
      let finishedAt = Number.POSITIVE_INFINITY;
      const p = checkUrl("https://a.example/start", slow, 4_000, PUBLIC).then(() => { finishedAt = Date.now(); });
      await vi.advanceTimersByTimeAsync(120_000);
      await p;
      expect(finishedAt - started).toBeLessThanOrEqual(12_000);
    } finally {
      vi.useRealTimers();
    }
  });
  it("a DNS lookup that never answers cannot hang the scan", async () => {
    vi.useFakeTimers();
    try {
      const never = () => new Promise<string[]>(() => {});
      let settled = false;
      const p = checkUrl("https://a.example/", status(200), 4_000, never).then(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(true);
      void p;
    } finally {
      vi.useRealTimers();
    }
  });
  it("a transient failure is not remembered for 24 hours", async () => {
    const cache = new Map<string, { at: number; status: LinkStatus }>();
    let up = false;
    const flaky = (async () => (up ? resp(200) : resp(503))) as unknown as typeof fetch;
    await checkMany(["https://flaky.example/p"], { fetchImpl: flaky, lookup: PUBLIC, cache });
    up = true;
    const second = await checkMany(["https://flaky.example/p"], { fetchImpl: flaky, lookup: PUBLIC, cache });
    // A person pressing "Scan again" a minute later must see the recovered link, not a cached outage.
    expect(second.get("https://flaky.example/p")?.outcome).toBe("ok");
  });
  it("the GET fallback does not leave the response body streaming (socket leak)", async () => {
    let cancelled = 0;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      const r = new Response(new ReadableStream({ start() {}, cancel() { cancelled += 1; } }), { status: init.method === "HEAD" ? 405 : 200 });
      return r;
    }) as unknown as typeof fetch;
    await checkUrl("https://a.example/", fetchImpl, 1000, PUBLIC);
    expect(cancelled).toBeGreaterThanOrEqual(1);
  });
});
