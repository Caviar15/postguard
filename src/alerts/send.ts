export const DEFAULT_FROM = "PostGuard <onboarding@resend.dev>";

export type MailConfig = { apiKey: string; to: string[]; from: string };

export function readMailConfig(env: Record<string, string | undefined> = process.env): { config: MailConfig | null; missing: string[] } {
  const apiKey = env.RESEND_API_KEY?.trim() ?? "";
  const to = (env.ALERT_EMAIL_TO ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const missing: string[] = [];
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (to.length === 0) missing.push("ALERT_EMAIL_TO");
  if (missing.length) return { config: null, missing };
  return { config: { apiKey, to, from: env.ALERT_EMAIL_FROM?.trim() || DEFAULT_FROM }, missing };
}

export type SendResult = { ok: true; id: string | null } | { ok: false; reason: string };

/** Resend REST API, plain fetch. The API key is only ever put in the Authorization header. */
export async function sendEmail(
  config: MailConfig,
  message: { subject: string; html: string; text: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.from, to: config.to, subject: message.subject, html: message.html, text: message.text }),
    });
    const json = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok) return { ok: false, reason: `Resend rejected the email (HTTP ${response.status})${json.message ? `: ${json.message}` : ""}.` };
    return { ok: true, id: json.id ?? null };
  } catch {
    return { ok: false, reason: "Could not reach Resend." };
  }
}
