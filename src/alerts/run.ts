import { timingSafeEqual } from "node:crypto";
import { BufferAuthError, BufferRateLimitError } from "@/buffer/client";
import { buildDemoReport } from "@/demo/build";
import { parseDemoPlatform } from "@/demo/platforms";
import type { ScanReport } from "@/domain/types";
import { scanLive } from "@/scan/live";
import { buildAlert } from "./build";
import { getWatchAccessToken, WatchCredentialError } from "./credentials";
import { readMailConfig, sendEmail } from "./send";
import { storeFromEnv, type WatchTokenStore } from "./token-store";

const WINDOW_DAYS = 7;

type Env = Record<string, string | undefined>;

export type CheckDeps = {
  env?: Env;
  fetchImpl?: typeof fetch;
  now?: Date;
  store?: WatchTokenStore | null;
  /** Test seam. Replaces the credentials and the Buffer scan. */
  getReport?: () => Promise<ScanReport>;
};

export type CheckResult = { status: number; body: Record<string, unknown> };

/** Fails closed: with no CRON_SECRET configured, nothing is authorised. */
export function isAuthorised(request: Request, env: Env): boolean {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function dashboardUrlFor(request: Request, env: Env): string {
  const configured = env.APP_URL?.trim();
  let origin = new URL(request.url).origin;
  if (configured) {
    try {
      origin = new URL(configured).origin;
    } catch {
      // keep the request origin
    }
  }
  return `${origin}/dashboard`;
}

export async function runCheck(request: Request, deps: CheckDeps = {}): Promise<CheckResult> {
  const env = deps.env ?? process.env;
  if (!isAuthorised(request, env)) {
    return { status: 401, body: { ok: false, error: "unauthorized" } };
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const demo = url.searchParams.get("source") === "demo";
  const now = deps.now ?? new Date();

  let report: ScanReport;
  try {
    if (deps.getReport) {
      report = await deps.getReport();
    } else if (demo) {
      report = await buildDemoReport(now, WINDOW_DAYS, false, parseDemoPlatform(url.searchParams.get("platform") ?? undefined));
    } else {
      const tokens = await getWatchAccessToken({
        seed: env.BUFFER_REFRESH_TOKEN ?? null,
        store: deps.store === undefined ? storeFromEnv(env, deps.fetchImpl) : deps.store,
        clientId: env.BUFFER_CLIENT_ID?.trim() ?? "",
        clientSecret: env.BUFFER_CLIENT_SECRET?.trim() || undefined,
        fetchImpl: deps.fetchImpl,
        now: () => now,
      });
      report = await scanLive({ accessToken: tokens.accessToken, windowDays: WINDOW_DAYS, includeDrafts: false, fetchImpl: deps.fetchImpl, now });
    }
  } catch (error) {
    if (error instanceof WatchCredentialError) {
      return { status: error.reason === "not_configured" ? 503 : 502, body: { ok: false, reason: error.reason, message: error.message } };
    }
    if (error instanceof BufferAuthError) {
      return { status: 502, body: { ok: false, reason: "buffer_auth", message: "Buffer rejected the access token." } };
    }
    if (error instanceof BufferRateLimitError) {
      return { status: 503, body: { ok: false, reason: "rate_limited", message: `Buffer rate limit reached. Try again in ${error.waitLabel}.` } };
    }
    return { status: 502, body: { ok: false, reason: "scan_failed", message: "The Buffer scan failed." } };
  }

  const alert = buildAlert(report, { dashboardUrl: dashboardUrlFor(request, env) });
  const summary = {
    ok: true,
    source: demo ? "demo" : "live",
    scannedAt: report.scannedAt,
    windowDays: report.windowDays,
    postsScanned: report.postsScanned,
    riskyPosts: alert?.posts.length ?? 0,
    blockers: alert?.blockers ?? 0,
    high: alert?.high ?? 0,
    notes: report.notes,
  };

  if (!alert) {
    return { status: 200, body: { ...summary, sent: false, reason: "nothing_to_report" } };
  }
  const rendered = { subject: alert.subject, html: alert.html, text: alert.text };

  if (dryRun) {
    return { status: 200, body: { ...summary, sent: false, reason: "dry_run", email: rendered } };
  }
  const mail = readMailConfig(env);
  if (!mail.config) {
    return {
      status: 200,
      body: { ...summary, sent: false, reason: `email_not_configured: set ${mail.missing.join(", ")}`, email: rendered },
    };
  }
  const result = await sendEmail(mail.config, rendered, deps.fetchImpl);
  if (!result.ok) {
    return { status: 502, body: { ...summary, ok: false, sent: false, reason: result.reason } };
  }
  return { status: 200, body: { ...summary, sent: true, to: mail.config.to.length, emailId: result.id } };
}
