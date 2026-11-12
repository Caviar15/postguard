import { createHash, timingSafeEqual } from "node:crypto";
import { BufferRateLimitError } from "@/buffer/client";
import type { ScanReport } from "@/domain/types";
import { UnreadableGrantError } from "./crypto";
import { escapeHtml, renderMessage } from "./message";
import { horizonFor, selectAlertItems } from "./select";
import type { AlertItem, RunDeps, RunResult } from "./types";

const HOUR = 3_600_000;
const RUN_LOCK_MS = 10 * 60_000;
/** A claim outlives any post it can be about: alerts only cover the next ~27 hours. */
const CLAIM_TTL_MS = 3 * 24 * HOUR;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

/**
 * One scheduled run over every subscriber. Never throws.
 *
 * Order matters for "no double emails": take the run lock, then for each post+finding claim its key
 * atomically (SET NX) BEFORE sending, send ONE message with a stable idempotency key, and give the
 * claims back if the send fails so the next run can try again.
 */
export async function runAlerts(deps: RunDeps, options: { dryRun?: boolean } = {}): Promise<RunResult> {
  const result: RunResult = { status: "ok", sent: 0, suppressed: 0, errors: [] };
  if (options.dryRun) result.previews = [];
  let release: (() => Promise<void>) | null = null;
  try {
    release = await deps.store.acquireLock("alerts-run", RUN_LOCK_MS);
    if (!release) return { ...result, status: "skipped-locked" };
    const subscribers = await deps.store.listSubscribers();
    // Email that cannot go out must fail loudly: a green cron that never delivers is the worst outcome.
    if (!options.dryRun && subscribers.some((s) => !s.unsubscribed) && deps.mailer.configured?.() === false) {
      deps.log.error("alerts: email delivery is not configured (RESEND_API_KEY)");
      return { ...result, status: "failed", errors: ["email delivery is not configured"] };
    }
    let succeeded = 0;
    for (const subscriber of subscribers) {
      if (subscriber.unsubscribed) continue;
      if (!subscriber.email) {
        result.errors.push(`${subscriber.id}: no recipient (ALERT_EMAIL_TO is not set)`);
        continue;
      }
      const now = deps.now();
      const horizonEnd = horizonFor(deps.config, now);
      let report: ScanReport;
      try {
        report = await deps.reader.scan(subscriber, { from: now, to: horizonEnd });
      } catch (error) {
        if (error instanceof BufferRateLimitError) {
          result.retryAfterSeconds = Math.max(result.retryAfterSeconds ?? 0, error.retryAfter);
        }
        result.errors.push(`${subscriber.id}: ${errorName(error)}`);
        deps.log.warn("alerts: reading the queue failed", { subscriber: subscriber.id, error: errorName(error) });
        continue;
      }

      const items = selectAlertItems(report, subscriber, { now, horizonEnd, appUrl: deps.config.appUrl });
      const render = (list: AlertItem[]) =>
        renderMessage(list, subscriber, {
          now,
          appUrl: deps.config.appUrl,
          report,
          hoursAhead: deps.config.cadenceHours + deps.config.jitterHours + deps.config.leadHours,
        });

      if (options.dryRun) {
        if (items.length > 0) {
          const { subject, text, html } = render(items);
          result.previews!.push({ subject, text, html });
        }
        succeeded += 1;
        continue;
      }

      // Every key taken below is given back unless the email really went out. A failure at ANY step (a Redis blip in
      // the middle of the claims, a renderer error, a mail provider error) must not leave claims behind: a claim
      // with no email would suppress that alert for CLAIM_TTL_MS.
      const taken: AlertItem[] = [];
      const fresh: AlertItem[] = [];
      let delivered = false;
      try {
        for (const item of items) {
          taken.push(item); // before the call: a SET that succeeded but whose answer was lost must be undone too
          if (await deps.store.claim(item.key, CLAIM_TTL_MS)) fresh.push(item);
          else {
            taken.pop();
            result.suppressed += 1;
          }
        }
        if (fresh.length > 0) {
          const message = render(fresh);
          const idempotencyKey = createHash("sha256")
            .update(`${subscriber.id}\n${fresh.map((item) => item.key).sort().join("\n")}`)
            .digest("hex");
          try {
            await deps.mailer.send(message, { idempotencyKey });
          } catch (error) {
            result.errors.push(`${subscriber.id}: the email could not be sent`);
            deps.log.warn("alerts: sending failed", { subscriber: subscriber.id, error: errorName(error) });
            throw error;
          }
          delivered = true;
          result.sent += 1;
        }
      } catch (error) {
        if (!delivered) for (const item of taken) await deps.store.unclaim(item.key).catch(() => undefined);
        if (!result.errors.some((entry) => entry.startsWith(`${subscriber.id}:`))) {
          result.errors.push(`${subscriber.id}: the alert could not be prepared`);
          deps.log.warn("alerts: preparing the alert failed", { subscriber: subscriber.id, error: errorName(error) });
        }
        continue;
      }
      await deps.store.setLastSuccess(subscriber.id, now.toISOString());
      succeeded += 1;
    }
    if (result.errors.length > 0) result.status = succeeded > 0 ? "partial" : "failed";
    deps.log.info("alerts: run finished", { status: result.status, sent: result.sent, suppressed: result.suppressed });
    return result;
  } catch (error) {
    deps.log.error("alerts: run crashed", { error: errorName(error) });
    const reason = error instanceof UnreadableGrantError ? "the saved alert grant cannot be read; turn alerts on again at /alerts/setup" : "the run crashed";
    return { ...result, status: "failed", errors: [...result.errors, reason] };
  } finally {
    if (release) await release().catch(() => undefined);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** CRON_SECRET must be a real secret. A short or missing one is a deployment mistake, not an auth success. */
export const MIN_SECRET_LENGTH = 16;

export function secretConfigured(env: Record<string, string | undefined>): string | null {
  const secret = env.CRON_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/** True when the request carries `Authorization: Bearer <secret>` for this exact secret. */
export function hasSecret(request: Request, secret: string): boolean {
  return safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

const JSON_HEADERS = { "cache-control": "no-store", "content-type": "application/json" };

/** GET /api/cron/alerts. Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. */
export async function handleCron(request: Request, deps: RunDeps): Promise<Response> {
  const secret = secretConfigured(deps.env);
  if (!secret) {
    deps.log.error("alerts: CRON_SECRET is not set (or shorter than 16 characters), so the cron route is closed");
    return new Response(JSON.stringify({ error: "alerts are not configured" }), { status: 500, headers: JSON_HEADERS });
  }
  if (!hasSecret(request, secret)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: JSON_HEADERS });
  }
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const result = await runAlerts(deps, { dryRun });
  const status = result.status === "failed" ? 503 : 200;
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (result.retryAfterSeconds) headers["retry-after"] = String(Math.ceil(result.retryAfterSeconds));
  const body: Record<string, unknown> = {
    status: result.status,
    sent: result.sent,
    suppressed: result.suppressed,
    errors: result.errors.length,
  };
  if (result.errors.length > 0) body.errorDetails = result.errors;
  if (result.retryAfterSeconds) body.retryAfterSeconds = result.retryAfterSeconds;
  if (dryRun) body.previews = result.previews ?? [];
  return new Response(JSON.stringify(body), { status, headers });
}

const PAGE_HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer", "content-type": "text/html; charset=utf-8" };

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:12vh auto;padding:0 20px;color:#1c1814;background:#f4efe4"><h1 style="font:600 1.6rem Georgia,serif">${escapeHtml(title)}</h1>${body}</body></html>`,
    { status, headers: PAGE_HEADERS },
  );
}

/**
 * /api/alerts/unsubscribe. GET only shows a confirmation, because mail scanners and link previews open
 * links. POST unsubscribes (RFC 8058 one-click sends a POST with `List-Unsubscribe=One-Click`).
 */
export async function handleUnsubscribe(request: Request, deps: RunDeps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" || request.method === "HEAD") {
    const token = url.searchParams.get("token") ?? "";
    return page(
      "Stop PostGuard alert emails?",
      `<p>PostGuard will stop emailing you and delete the Buffer access it saved for alerts.</p><form method="post" action="/api/alerts/unsubscribe?token=${encodeURIComponent(token)}"><button type="submit" style="font:inherit;padding:10px 18px;border-radius:999px;border:1px solid #1c1814;background:#1c1814;color:#fff;cursor:pointer">Stop alert emails</button></form>`,
    );
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { ...PAGE_HEADERS, allow: "GET, POST" } });
  let token = url.searchParams.get("token");
  if (!token) {
    const body = await request.text().catch(() => "");
    token = new URLSearchParams(body).get("token");
  }
  if (!token || token.length < 20) return page("This link does not work", "<p>The unsubscribe link is not valid.</p>", 400);
  let ok = false;
  try {
    ok = await deps.store.unsubscribe(token);
  } catch {
    deps.log.error("alerts: unsubscribe failed");
    return page("Something went wrong", "<p>Try the link again in a moment.</p>", 503);
  }
  if (!ok) return page("This link does not work", "<p>The unsubscribe link is not valid.</p>", 404);
  return page("You are unsubscribed", "<p>PostGuard will not email you alerts any more, and the saved Buffer access was deleted. You can also revoke PostGuard in Buffer under Settings → API.</p>");
}
