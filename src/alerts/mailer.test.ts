import { describe, expect, it, vi } from "vitest";
import { ResendMailer } from "./mailer";

const message = {
  to: "owner@example.test",
  subject: "s",
  text: "t",
  html: "<p>h</p>",
  headers: { "List-Unsubscribe": "<https://postguard.test/api/alerts/unsubscribe?token=x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
};

describe("Resend mailer", () => {
  it("posts to Resend with the idempotency key and the one-click unsubscribe headers", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "em_1" }), { status: 200 }));
    const mailer = new ResendMailer({ apiKey: "re_secret_key", from: "PostGuard <onboarding@resend.dev>" }, fetchImpl as unknown as typeof fetch);
    expect(await mailer.send(message, { idempotencyKey: "abc123" })).toEqual({ id: "em_1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("abc123");
    expect(headers.authorization).toBe("Bearer re_secret_key");
    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(["owner@example.test"]);
    expect(body.headers["List-Unsubscribe"]).toContain("/api/alerts/unsubscribe");
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it("throws on a non-2xx answer without the API key or the response body in the message", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "key re_secret_key is bad" }), { status: 401 }));
    const mailer = new ResendMailer({ apiKey: "re_secret_key", from: "x" }, fetchImpl as unknown as typeof fetch);
    const error = await mailer.send(message, { idempotencyKey: "k" }).catch((e) => e);
    expect(error.message).toContain("401");
    expect(error.message).not.toContain("re_secret_key");
  });

  it("does not leak the key when the network fails, and refuses without a key or recipient", async () => {
    const down = new ResendMailer({ apiKey: "re_secret_key", from: "x" }, (async () => { throw new Error("connect re_secret_key"); }) as unknown as typeof fetch);
    expect((await down.send(message, { idempotencyKey: "k" }).catch((e) => e)).message).not.toContain("re_secret_key");
    await expect(new ResendMailer({ apiKey: "", from: "x" }).send(message, { idempotencyKey: "k" })).rejects.toThrow(/RESEND_API_KEY/);
    await expect(new ResendMailer({ apiKey: "k", from: "x" }).send({ ...message, to: "" }, { idempotencyKey: "k" })).rejects.toThrow(/ALERT_EMAIL_TO/);
  });

  it("can point at another endpoint (used by the local end-to-end run so nothing is emailed)", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await new ResendMailer({ apiKey: "k", from: "x", endpoint: "http://127.0.0.1:9/" }, fetchImpl as unknown as typeof fetch).send(message, { idempotencyKey: "k" });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("http://127.0.0.1:9/");
  });
});
