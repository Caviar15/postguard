import { describe, expect, it } from "vitest";
import { staticUrlRisk } from "./risk";
import { checkMany, checkUrl } from "./checker";
import { isBlockedAddress } from "./ssrf";

const publicLookup = async () => ["93.184.216.34"];

function response(status: number, headers: Record<string, string> = {}, body = ""): Response {
  return new Response(body, { status, headers });
}

describe("static URL risk", () => {
  it("recognises signed and private-host media", () => {
    expect(staticUrlRisk("https://bucket.s3.amazonaws.com/a.jpg?X-Amz-Expires=60&X-Amz-Signature=abc")?.kind).toBe("expiring");
    expect(staticUrlRisk("https://cdn.example/a.jpg?Expires=10&Signature=abc")?.kind).toBe("expiring");
    expect(staticUrlRisk("https://res.cloudinary.com/demo/image/upload/s--Ab3--/v1/a.jpg")?.kind).toBe("expiring");
    expect(staticUrlRisk("https://drive.google.com/file/d/abc/view")?.kind).toBe("private-host");
    expect(staticUrlRisk("https://www.dropbox.com/s/abc/a.jpg?dl=0")?.kind).toBe("private-host");
    expect(staticUrlRisk("https://cdn.example/a.jpg")).toBeNull();
  });
});

describe("link checker", () => {
  it("falls back from HEAD to GET and follows redirects itself", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/missing") && method === "HEAD") return response(404);
      if (url.endsWith("/missing") && method === "GET") return response(404, {}, "missing");
      if (url.endsWith("/gone")) return response(302, { location: "https://shop.example/" });
      if (url === "https://shop.example/") return response(200);
      if (url.endsWith("/chain")) return response(302, { location: "https://shop.example/c2" });
      if (url.endsWith("/c2")) return response(302, { location: "https://shop.example/c3" });
      if (url.endsWith("/c3")) return response(302, { location: "https://shop.example/c4" });
      if (url.endsWith("/c4")) return response(302, { location: "https://shop.example/done" });
      if (url.endsWith("/done")) return response(200);
      if (url.endsWith("/blocked")) return response(403);
      if (url.startsWith("http://insecure.example")) return response(200);
      return response(200);
    };

    const dead = await checkUrl("https://shop.example/missing", fetchImpl, 5_000, publicLookup);
    expect(dead.outcome).toBe("dead");
    expect(dead.status).toBe(404);

    const soft = await checkUrl("https://shop.example/gone", fetchImpl, 5_000, publicLookup);
    expect(soft.outcome).toBe("soft-404");

    const chain = await checkUrl("https://shop.example/chain", fetchImpl, 5_000, publicLookup);
    expect(chain.outcome).toBe("redirect");
    expect(chain.hops).toBe(4);

    const blocked = await checkUrl("https://shop.example/blocked", fetchImpl, 5_000, publicLookup);
    expect(blocked.outcome).toBe("unverified");

    const insecure = await checkUrl("http://insecure.example/a", fetchImpl, 5_000, publicLookup);
    expect(insecure.outcome).toBe("insecure");
  });

  it("reports timeouts and DNS failures without calling them the same thing", async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    const timedOut = await checkUrl("https://slow.example/a", hanging, 20, publicLookup);
    expect(timedOut.outcome).toBe("unverified");

    const failing: typeof fetch = async () => {
      throw new TypeError("getaddrinfo ENOTFOUND");
    };
    const dead = await checkUrl("https://no-such-host.example/a", failing, 5_000, publicLookup);
    expect(dead.outcome).toBe("dead");
  });

  it("checks one host at a time and reuses a cache", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return response(200);
    };
    const cache = new Map();
    const first = await checkMany(["https://a.example/1", "https://a.example/2", "https://b.example/1"], {
      fetchImpl,
      cache,
      delayMs: 0,
      concurrency: 2,
      lookup: publicLookup,
    });
    expect(first.size).toBe(3);
    expect(calls).toBe(3);
    const second = await checkMany(["https://a.example/1"], { fetchImpl, cache, delayMs: 0, lookup: publicLookup });
    expect(second.get("https://a.example/1")?.outcome).toBe("ok");
    expect(calls).toBe(3);
  });

  it("refuses private, metadata, and non-default targets, including after a redirect", async () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.1.2.3")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("100.64.0.1")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("fd00::1")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("1.1.1.1")).toBe(false);

    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url === "https://public.example/start") return response(302, { location: "http://127.0.0.1/secret" });
      throw new Error(`fetched a blocked target: ${url}`);
    };
    const lookup = async (hostname: string) => (hostname === "public.example" ? ["1.1.1.1"] : ["127.0.0.1"]);
    const redirected = await checkUrl("https://public.example/start", fetchImpl, 5_000, lookup);
    expect(redirected.outcome).toBe("unverified");
    expect(redirected.detail).toMatch(/private|loopback|link-local|metadata/i);

    const metadata = await checkUrl("http://169.254.169.254/latest/meta-data", fetchImpl, 5_000, async () => ["169.254.169.254"]);
    expect(metadata.outcome).toBe("unverified");

    const oddPort = await checkUrl("https://public.example:8443/a", fetchImpl, 5_000, publicLookup);
    expect(oddPort.outcome).toBe("unverified");
    expect(oddPort.detail).toMatch(/port/i);
  });
});
