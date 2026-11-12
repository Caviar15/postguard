import { refreshAccessToken } from "@/auth/oauth";
import { safeZone } from "./message";
import { DEFAULT_FROM, ResendMailer } from "./mailer";
import { LiveQueueReader } from "./reader";
import { RedisAlertStore, redisFromEnv } from "./redis";
import { getAccessToken } from "./grant";
import type { AlertStore, Logger, RunDeps } from "./types";

type Env = Record<string, string | undefined>;

export const DEFAULT_TIME_ZONE = "Europe/Amsterdam";

/** The public origin used in every link in an email. Never a preview deployment, never a guess from a header. */
export function appUrlFor(request: Request, env: Env): string {
  const configured = env.APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through
    }
  }
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production.replace(/^https?:\/\//, "")}`;
  return new URL(request.url).origin;
}

export const consoleLogger: Logger = {
  info: (message, data) => console.info(message, data ?? ""),
  warn: (message, data) => console.warn(message, data ?? ""),
  error: (message, data) => console.error(message, data ?? ""),
};

export function alertSettings(env: Env): { email: string; timeZone: string } {
  return {
    email: (env.ALERT_EMAIL_TO ?? "").split(",")[0]!.trim(),
    timeZone: safeZone(env.ALERT_TIME_ZONE?.trim()) ?? DEFAULT_TIME_ZONE,
  };
}

export function storeFromEnv(env: Env = process.env, fetchImpl?: typeof fetch): { store: RedisAlertStore; configured: boolean } {
  const { client, configured } = redisFromEnv(env, fetchImpl);
  return { store: new RedisAlertStore(client, env.SESSION_SECRET?.trim() ?? "", () => alertSettings(env)), configured };
}

/**
 * With no Redis there is no way to have turned alerts on, so the daily cron has nothing to do. That is
 * "not set up", not a failure: the run answers 200 and logs it, and /alerts/setup shows what is missing.
 */
const NOT_SET_UP: AlertStore = {
  async listSubscribers() {
    return [];
  },
  async acquireLock() {
    return async () => undefined;
  },
  async claim() {
    return false;
  },
  async unclaim() {},
  async getLastSuccess() {
    return null;
  },
  async setLastSuccess() {},
  async unsubscribe() {
    return false;
  },
};

/** The real dependencies for the cron route. Everything else is testable without a network. */
export function buildDeps(request: Request, env: Env = process.env, fetchImpl?: typeof fetch): RunDeps {
  const { store: redisStore, configured } = storeFromEnv(env, fetchImpl);
  const store = redisStore;
  const now = () => new Date();
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const reader = new LiveQueueReader((subscriber) =>
    getAccessToken(
      {
        grants: store,
        now,
        sleep,
        refresh: (refreshToken) =>
          refreshAccessToken({
            refreshToken,
            clientId: env.BUFFER_CLIENT_ID?.trim() ?? "",
            clientSecret: env.BUFFER_CLIENT_SECRET?.trim() || undefined,
            fetchImpl,
          }),
      },
      subscriber.id,
    ),
  );
  if (!configured) console.warn("alerts: no Redis configured (KV_REST_API_URL / KV_REST_API_TOKEN), so alerts are not set up");
  return {
    store: configured ? store : NOT_SET_UP,
    reader,
    mailer: new ResendMailer(
      { apiKey: env.RESEND_API_KEY?.trim() ?? "", from: env.ALERT_EMAIL_FROM?.trim() || DEFAULT_FROM, endpoint: env.MAIL_PROVIDER_URL?.trim() || undefined },
      fetchImpl,
    ),
    now,
    log: consoleLogger,
    // Vercel Hobby runs the cron once a day, anywhere within its hour. Pro can lower cadenceHours.
    config: { appUrl: appUrlFor(request, env), cadenceHours: 24, jitterHours: 1, leadHours: 2 },
    sleep,
    env,
  };
}
