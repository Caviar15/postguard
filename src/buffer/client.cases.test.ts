/** Critical tests: Buffer client and config. Drop into src/critical/client.test.ts */
import { describe, expect, it } from "vitest";
import { BufferClient } from "@/buffer/client";
import { parseRateLimit } from "@/buffer/rate-limit";
import { clampDays } from "@/config";

describe("config", () => {
  it("clampDays: blank / garbage / extreme values fall back sensibly", () => {
    expect(clampDays("", 7)).toBe(7);
    expect(clampDays("abc", 7)).toBe(7);
    expect(clampDays("-3", 7)).toBe(1);
    expect(clampDays("1e9", 7)).toBe(30);
    expect(clampDays(undefined, 7)).toBe(7);
  });
});

describe("Buffer client", () => {
  it("gives up when Buffer never answers (no unbounded hang)", async () => {
    const never = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const client = new BufferClient("t", never, "https://api.buffer.com", 100);
    const winner = await Promise.race([
      client.query("{ a }").then(() => "answered", () => "rejected"),
      new Promise<string>((r) => setTimeout(() => r("hung"), 300)),
    ]);
    // A real implementation passes an AbortSignal; with fake fetch we check one was supplied.
    expect(winner).not.toBe("hung");
  }, 2_000);
  it("sends an abort signal with every request", async () => {
    let signal: AbortSignal | null | undefined;
    const f = (async (_u: string, init: RequestInit) => {
      signal = init.signal;
      return new Response(JSON.stringify({ data: { ok: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    await new BufferClient("t", f).query("{ a }");
    expect(signal).toBeTruthy();
  });
  it("rate-limit header parser never throws on hostile headers", () => {
    for (const h of ['"x";r=abc', ";;;", '"a";r=99999999999999999999999', "\u0000", '"a";r=-1;t=-5', '","', '"']) {
      expect(() => parseRateLimit(h, h)).not.toThrow();
    }
  });
  it("401 maps to an auth error and 429 carries Retry-After", async () => {
    const mk = (status: number, headers: Record<string, string> = {}) => (async () => new Response(JSON.stringify({ errors: [{ message: "m" }] }), { status, headers })) as unknown as typeof fetch;
    await expect(new BufferClient("t", mk(401)).query("{a}")).rejects.toMatchObject({ name: "BufferAuthError" });
    await expect(new BufferClient("t", mk(429, { "retry-after": "42" })).query("{a}")).rejects.toMatchObject({ name: "BufferRateLimitError", retryAfter: 42 });
  });
});
