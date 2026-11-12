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
  constructor(retryAfter: number, message = "Buffer rate limit reached.") {
    super(message);
    this.name = "BufferRateLimitError";
    this.retryAfter = retryAfter;
  }
}

export class BufferApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BufferApiError";
  }
}

type GraphQLError = { message?: string };

/** Buffer's shortest documented quota window. A 429 with no usable Retry-After would otherwise say "0 seconds". */
const RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

function retryAfterSeconds(header: string | null): number {
  if (header == null || header.trim() === "") return RATE_LIMIT_WINDOW_SECONDS;
  const parsed = Number(header);
  if (!Number.isFinite(parsed) || parsed <= 0) return RATE_LIMIT_WINDOW_SECONDS;
  return parsed;
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
      throw new BufferRateLimitError(retryAfterSeconds(response.headers.get("retry-after")), message);
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
