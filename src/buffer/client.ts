import type { QuotaWindow } from "@/domain/types";
import { parseRateLimit } from "./rate-limit";

export class BufferAuthError extends Error {
  constructor(message = "Buffer rejected the access token.") {
    super(message);
    this.name = "BufferAuthError";
  }
}

export class BufferRateLimitError extends Error {
  retryAfter: number;
  waitLabel: string;
  constructor(retryAfter: number, message = "Buffer rate limit reached.") {
    super(message);
    this.name = "BufferRateLimitError";
    this.retryAfter = retryAfter;
    this.waitLabel = waitLabel(retryAfter);
  }
}

export class BufferApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BufferApiError";
  }
}

type GraphQLError = { message?: string; extensions?: { window?: unknown } };

/** App-client windows named in a 429 body: extensions.window. */
const WINDOW_SECONDS: Record<string, number> = {
  "15m": 15 * 60,
  "24h": 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
};

/** Buffer's shortest app-client window, used only when the 429 names neither a header nor a window. */
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

function retryAfterSeconds(header: string | null, window: unknown): number {
  if (header != null && header.trim() !== "") {
    const parsed = Number(header);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (typeof window === "string" && WINDOW_SECONDS[window] !== undefined) return WINDOW_SECONDS[window];
  return RATE_LIMIT_WINDOW_SECONDS;
}

/** A person should not have to read a raw second count. */
export function waitLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "about 15 minutes";
  if (seconds < 90) return "about a minute";
  if (seconds < 90 * 60) return `about ${Math.max(2, Math.round(seconds / 60))} minutes`;
  if (seconds < 36 * 60 * 60) {
    const hours = Math.max(1, Math.round(seconds / 3600));
    return hours === 1 ? "about 1 hour" : `about ${hours} hours`;
  }
  const days = Math.max(1, Math.round(seconds / 86400));
  return days === 1 ? "about 1 day" : `about ${days} days`;
}

export class BufferClient {
  quota: QuotaWindow[] = [];
  requests = 0;

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = "https://api.buffer.com",
    private readonly timeoutMs = 15_000,
  ) {}

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    this.requests += 1;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new BufferApiError(`Buffer did not answer within ${Math.round(this.timeoutMs / 1000)} seconds.`));
      }, this.timeoutMs);
    });
    let response: Response;
    try {
      response = await Promise.race([
        this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({ query, variables }),
          signal: controller.signal,
        }),
        timedOut,
      ]);
    } catch (error) {
      if (error instanceof BufferApiError) throw error;
      throw new BufferApiError("Could not reach Buffer. Try again in a moment.");
    } finally {
      clearTimeout(timer);
    }

    this.quota = parseRateLimit(response.headers.get("ratelimit"), response.headers.get("ratelimit-policy"));
    const body = (await response.json().catch(() => null)) as { data?: T; errors?: GraphQLError[] } | null;

    if (response.status === 401) throw new BufferAuthError();
    if (response.status === 429) {
      const message = body?.errors?.[0]?.message ?? "Too many requests from this client.";
      const window = body?.errors?.[0]?.extensions?.window;
      throw new BufferRateLimitError(retryAfterSeconds(response.headers.get("retry-after"), window), message);
    }
    if (!response.ok) {
      throw new BufferApiError(body?.errors?.[0]?.message ?? `Buffer returned HTTP ${response.status}.`);
    }
    if (body?.errors && body.errors.length > 0 && !body.data) {
      throw new BufferApiError(body.errors[0]?.message ?? "Buffer returned a GraphQL error.");
    }
    if (!body?.data) throw new BufferApiError("Buffer returned an empty response.");
    return body.data;
  }
}
