import { createHash } from "node:crypto";
import { open, seal } from "@/auth/seal";

/**
 * Buffer refresh tokens are single use: every refresh returns a new one and
 * invalidates the one that was sent. A background job therefore has to save the
 * replacement somewhere it can read next time. An env var cannot do that.
 */
export type WatchGrant = {
  refreshToken: string;
  /** Hash of the BUFFER_REFRESH_TOKEN this chain was started from. A new env value starts a new chain. */
  seedHash: string;
  updatedAt: string;
};

export interface WatchTokenStore {
  readonly name: string;
  read(): Promise<WatchGrant | null>;
  write(grant: WatchGrant): Promise<void>;
}

export function hashSeed(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}

const KEY = "postguard:watch-grant";

type Env = Record<string, string | undefined>;

/**
 * Upstash Redis over its REST API (plain fetch). Vercel's Marketplace Upstash
 * integration sets KV_REST_API_URL / KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_*.
 * The token is encrypted with SESSION_SECRET before it is written.
 */
export class UpstashTokenStore implements WatchTokenStore {
  readonly name = "upstash";
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly secret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async command(args: string[]): Promise<unknown> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error(`Token store answered HTTP ${response.status}.`);
    const json = (await response.json()) as { result?: unknown; error?: string };
    if (json.error) throw new Error("Token store returned an error.");
    return json.result;
  }

  async read(): Promise<WatchGrant | null> {
    const result = await this.command(["GET", KEY]);
    if (typeof result !== "string") return null;
    return open<WatchGrant>(result, this.secret);
  }

  async write(grant: WatchGrant): Promise<void> {
    await this.command(["SET", KEY, seal(grant, this.secret)]);
  }
}

export function storeFromEnv(env: Env = process.env, fetchImpl?: typeof fetch): WatchTokenStore | null {
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").trim();
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  const secret = (env.SESSION_SECRET || "").trim();
  if (!url || !token || !secret) return null;
  return new UpstashTokenStore(url, token, secret, fetchImpl);
}
