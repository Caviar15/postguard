import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { openGrant, sealGrant, UnreadableGrantError } from "./crypto";
import type { AlertStore, Release, Subscriber } from "./types";

/** PostGuard's own alert store (Upstash) failed. Not a Buffer problem. */
export class AlertStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertStoreError";
  }
}

/** The only thing the store needs from Redis. Upstash's REST API takes the command as a JSON array. */
export interface RedisClient {
  command(args: Array<string | number>): Promise<unknown>;
}

export class UpstashRedis implements RedisClient {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
  ) {}

  async command(args: Array<string | number>): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AlertStoreError("Alert store did not answer.");
    }
    if (!response.ok) throw new AlertStoreError(`Alert store answered HTTP ${response.status}.`);
    const json = (await response.json().catch(() => ({ error: "unreadable" }))) as { result?: unknown; error?: string };
    if (json.error) throw new AlertStoreError("Alert store returned an error.");
    return json.result;
  }
}

class MissingRedis implements RedisClient {
  async command(): Promise<unknown> {
    throw new Error("The alert store is not configured. Set KV_REST_API_URL and KV_REST_API_TOKEN.");
  }
}

/** Vercel's Upstash integration sets KV_REST_API_*, Upstash's own docs use UPSTASH_REDIS_REST_*. */
export function redisFromEnv(env: Record<string, string | undefined>, fetchImpl?: typeof fetch): { client: RedisClient; configured: boolean } {
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (!url || !token) return { client: new MissingRedis(), configured: false };
  return { client: new UpstashRedis(url, token, fetchImpl), configured: true };
}

/** What is kept for the owner who turned alerts on. Encrypted as one value. */
export type StoredSubscriber = {
  id: string;
  unsubscribeToken: string;
  unsubscribed: boolean;
  /** Null after unsubscribe or turn-off: the token is deleted, not just ignored. */
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: number;
  enabledAt: string;
};

export const OWNER_ID = "owner";
const NS = "pg:alerts";
const subKey = (id: string) => `${NS}:sub:${id}`;
const claimKey = (key: string) => `${NS}:claim:${createHash("sha256").update(key).digest("hex")}`;
const lockKey = (name: string) => `${NS}:lock:${name}`;
const lastKey = (id: string) => `${NS}:last:${id}`;

/** Deletes the lock only if it is still ours, so a slow run cannot release someone else's lock. */
const RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SubscriberSettings = { email: string; timeZone: string | null };

export class RedisAlertStore implements AlertStore {
  constructor(
    private readonly redis: RedisClient,
    private readonly secret: string,
    private readonly settings: () => SubscriberSettings,
  ) {}

  private key(): string {
    if (!this.secret) throw new Error("SESSION_SECRET is not set.");
    return this.secret;
  }

  async readSubscriber(id = OWNER_ID): Promise<StoredSubscriber | null> {
    const value = await this.redis.command(["GET", subKey(id)]);
    if (typeof value !== "string") return null;
    const record = openGrant<StoredSubscriber>(value, this.key());
    // A value that is there but cannot be opened is NOT "no grant": say so, never act as if alerts were off.
    if (!record) throw new UnreadableGrantError();
    return record;
  }

  async writeSubscriber(record: StoredSubscriber): Promise<void> {
    await this.redis.command(["SET", subKey(record.id), sealGrant(record, this.key())]);
  }

  /** The owner turns alerts on: a new grant, a new unsubscribe token, and a clean slate. */
  async enable(tokens: { accessToken: string; refreshToken: string; expiresAt: number }, now = new Date()): Promise<void> {
    await this.writeSubscriber({
      id: OWNER_ID,
      unsubscribeToken: randomBytes(32).toString("base64url"),
      unsubscribed: false,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      enabledAt: now.toISOString(),
    });
  }

  async isEnabled(): Promise<boolean> {
    const record = await this.readSubscriber();
    return Boolean(record && !record.unsubscribed && record.refreshToken);
  }

  /** The owner turns alerts off from the setup page. Same effect as the unsubscribe link. */
  async disable(): Promise<void> {
    let record: StoredSubscriber | null;
    try {
      record = await this.readSubscriber();
    } catch (error) {
      if (!(error instanceof UnreadableGrantError)) throw error;
      // Nothing in it can be used any more; the owner asked to turn alerts off, so remove it.
      await this.redis.command(["DEL", subKey(OWNER_ID)]);
      return;
    }
    if (record) await this.writeSubscriber(wipe(record));
  }

  async listSubscribers(): Promise<Subscriber[]> {
    const record = await this.readSubscriber();
    if (!record) return [];
    const { email, timeZone } = this.settings();
    return [
      {
        id: record.id,
        email,
        organizationId: "",
        timeZone,
        unsubscribed: record.unsubscribed,
        unsubscribeToken: record.unsubscribeToken,
        credentials: { accessToken: record.accessToken ?? "", refreshToken: record.refreshToken, expiresAt: record.expiresAt },
      },
    ];
  }

  /** GrantStore */
  async readGrant(id: string) {
    const record = await this.readSubscriber(id);
    if (!record || record.unsubscribed) return null;
    return { refreshToken: record.refreshToken, accessToken: record.accessToken, expiresAt: record.expiresAt };
  }

  /** GrantStore. Never brings back a grant that was turned off while a refresh was running. */
  async writeGrant(id: string, grant: { refreshToken: string; accessToken: string; expiresAt: number }): Promise<void> {
    const record = await this.readSubscriber(id);
    if (!record || record.unsubscribed) throw new Error("Alerts were turned off.");
    await this.writeSubscriber({ ...record, ...grant });
  }

  async acquireLock(name: string, ttlMs: number): Promise<Release | null> {
    const owner = randomBytes(16).toString("hex");
    const result = await this.redis.command(["SET", lockKey(name), owner, "NX", "PX", ttlMs]);
    if (result !== "OK") return null;
    return async () => {
      await this.redis.command(["EVAL", RELEASE_SCRIPT, 1, lockKey(name), owner]);
    };
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    const result = await this.redis.command(["SET", claimKey(key), "1", "NX", "PX", ttlMs]);
    return result === "OK";
  }

  async unclaim(key: string): Promise<void> {
    await this.redis.command(["DEL", claimKey(key)]);
  }

  async getLastSuccess(subscriberId: string): Promise<string | null> {
    const value = await this.redis.command(["GET", lastKey(subscriberId)]);
    return typeof value === "string" ? value : null;
  }

  async setLastSuccess(subscriberId: string, iso: string): Promise<void> {
    await this.redis.command(["SET", lastKey(subscriberId), iso]);
  }

  async unsubscribe(token: string): Promise<boolean> {
    const record = await this.readSubscriber();
    if (!record || !token || !same(record.unsubscribeToken, token)) return false;
    await this.writeSubscriber(wipe(record));
    return true;
  }
}

function wipe(record: StoredSubscriber): StoredSubscriber {
  return { ...record, unsubscribed: true, refreshToken: null, accessToken: null, expiresAt: 0 };
}
