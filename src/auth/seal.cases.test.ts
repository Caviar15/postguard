/** Critical tests: sealed cookies. Drop into src/critical/seal.test.ts */
import { describe, expect, it } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { open, seal } from "@/auth/seal";

describe("sealed cookies", () => {
  const secret = "unit-test-secret-long-enough-xxxxxxxx";
  it("rejects a ciphertext whose GCM tag was truncated to 4 bytes (forgery needs only 2^32 tries)", () => {
    const sealed = seal({ accessToken: "a", expiresAt: 1 }, secret);
    const [iv, tag, data] = sealed.split(".");
    const short = Buffer.from(tag!, "base64url").subarray(0, 4).toString("base64url");
    expect(open(`${iv}.${short}.${data}`, secret)).toBeNull();
  });
  it("rejects garbage, empty and oversized inputs without throwing", () => {
    for (const t of ["", ".", "..", "a.b.c", "a.b", "....", "x".repeat(100_000)]) expect(open(t, secret)).toBeNull();
  });
  it("tokens differ for the same payload (fresh IV every time)", () => {
    expect(seal({ a: 1 }, secret)).not.toBe(seal({ a: 1 }, secret));
  });
  it("ciphertext from another key never opens", () => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", createHash("sha256").update("other").digest(), iv);
    const body = Buffer.concat([c.update('{"x":1}'), c.final()]);
    expect(open([iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join("."), secret)).toBeNull();
  });
});
