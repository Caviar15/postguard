import type { Mailer, OutgoingMessage } from "./types";

export const DEFAULT_FROM = "PostGuard <onboarding@resend.dev>";

/**
 * Resend's REST API with plain fetch. The Idempotency-Key header makes a retry of the same alert safe
 * (Resend remembers a key for 24 hours). The API key only ever goes into the Authorization header, and
 * error messages carry the HTTP status, never the key or the response body.
 */
export class ResendMailer implements Mailer {
  constructor(
    private readonly options: { apiKey: string; from: string; endpoint?: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  configured(): boolean {
    return Boolean(this.options.apiKey);
  }

  async send(message: OutgoingMessage, { idempotencyKey }: { idempotencyKey: string }): Promise<{ id: string }> {
    if (!this.options.apiKey) throw new Error("RESEND_API_KEY is not set.");
    if (!message.to) throw new Error("ALERT_EMAIL_TO is not set.");
    let response: Response;
    try {
      response = await this.fetchImpl(this.options.endpoint ?? "https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
        }),
      });
    } catch {
      throw new Error("Could not reach the mail provider.");
    }
    if (!response.ok) throw new Error(`The mail provider answered HTTP ${response.status}.`);
    const json = (await response.json().catch(() => ({}))) as { id?: string };
    return { id: json.id ?? "unknown" };
  }
}
