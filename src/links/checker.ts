import type { LinkStatus } from "@/domain/types";
import { isHttpUrl } from "@/domain/urls";
import { assertPublicHttpUrl, UnsafeUrlError, type LookupFn, defaultLookup } from "./ssrf";

export type CheckOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  delayMs?: number;
  concurrency?: number;
  ttlMs?: number;
  cache?: Map<string, { at: number; status: LinkStatus }>;
  lookup?: LookupFn;
};

const globalCache = new Map<string, { at: number; status: LinkStatus }>();

export function clearLinkCache(): void {
  globalCache.clear();
}

/**
 * Remember answers that will not change on their own. A timeout, a 5xx, a DNS
 * hiccup or a refused bot check is not one of them, and caching it for a day
 * would make "Scan again" repeat a transient failure.
 */
function worthCaching(status: LinkStatus): boolean {
  if (status.outcome === "unverified") return false;
  if (status.outcome === "dead") return status.status === 404 || status.status === 410;
  return true;
}

function result(
  url: string,
  outcome: LinkStatus["outcome"],
  status: number | null,
  hops: number,
  finalUrl: string | null,
  detail: string,
): LinkStatus {
  return { url, outcome, status, hops, finalUrl, detail };
}

class DeadlineError extends Error {
  constructor() {
    super("Timed out before the host responded.");
    this.name = "TimeoutError";
  }
}

async function fetchOnce(
  fetchImpl: typeof fetch,
  url: string,
  method: "HEAD" | "GET",
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    const response = await fetchImpl(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": "PostGuard/0.1 (Buffer queue health check)",
        accept: "*/*",
      },
    });
    // Only the status line and headers matter. Do not leave a body streaming on a held socket.
    void response.body?.cancel().catch(() => undefined);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/** A DNS lookup has no abort signal of its own, so race it against the remaining budget. */
async function lookupWithin(lookup: LookupFn, ms: number): Promise<LookupFn> {
  return async (hostname: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        lookup(hostname),
        new Promise<string[]>((_resolve, reject) => {
          timer = setTimeout(() => reject(new DeadlineError()), Math.max(1, ms));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

function classify(original: string, current: string, status: number, hops: number): LinkStatus {
  if (status === 401 || status === 403 || status === 429 || status === 408) {
    return result(original, "unverified", status, hops, current, `HTTP ${status}. The host refused or throttled an automated check, so this is not marked dead.`);
  }
  // 5xx is an outage on their side, and 999 is LinkedIn's "no bots" answer. Neither proves the link is gone.
  if (status >= 500 || status === 999) {
    return result(original, "unverified", status, hops, current, `HTTP ${status}. The host errored or refused an automated check, so this is not marked dead.`);
  }
  if (status < 200 || status >= 300) {
    return result(original, "dead", status, hops, current, `HTTP ${status}.`);
  }

  let finalPath = "/";
  let finalProtocol = "https:";
  let originalPath = "/";
  try {
    const finalUrl = new URL(current);
    finalPath = finalUrl.pathname;
    finalProtocol = finalUrl.protocol;
    originalPath = new URL(original).pathname;
  } catch {
    // Fall through to a plain success if the final URL cannot be parsed.
  }

  if (hops > 0 && (finalPath === "/" || finalPath === "") && originalPath !== "/" && originalPath !== "") {
    return result(original, "soft-404", status, hops, current, `Redirected ${hops} time${hops === 1 ? "" : "s"} to the site root. That usually means the path is gone.`);
  }
  if (original.startsWith("http://") || finalProtocol === "http:") {
    return result(original, "insecure", status, hops, current, "The link uses http, or redirects to http.");
  }
  if (hops > 3) {
    return result(original, "redirect", status, hops, current, `Redirect chain is ${hops} hops. Long chains rot, and some networks drop them.`);
  }
  return result(original, "ok", status, hops, current, `HTTP ${status}.`);
}

export async function checkUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5_000,
  lookupImpl: LookupFn = defaultLookup,
): Promise<LinkStatus> {
  if (!isHttpUrl(url)) {
    return result(url, "dead", null, 0, null, "Not an http(s) URL.");
  }

  let current = url;
  let hops = 0;
  const seen = new Set<string>([current]);
  let method: "HEAD" | "GET" = "HEAD";
  // One URL gets two attempts' worth of time in total, however long the redirect chain is.
  const deadline = Date.now() + timeoutMs * 2;
  const remaining = () => deadline - Date.now();

  try {
    for (;;) {
      if (remaining() <= 0) throw new DeadlineError();
      try {
        await assertPublicHttpUrl(current, await lookupWithin(lookupImpl, Math.min(timeoutMs, remaining())));
      } catch (error) {
        if (error instanceof UnsafeUrlError) {
          const timedOut = error.cause instanceof DeadlineError;
          return result(url, "unverified", null, hops, current, timedOut ? "Timed out resolving the host." : error.message);
        }
        throw error;
      }
      if (remaining() <= 0) throw new DeadlineError();
      const response = await fetchOnce(fetchImpl, current, method, Math.min(timeoutMs, remaining()));
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return result(url, "dead", response.status, hops, current, "Redirect with no Location header.");
        }
        const next = new URL(location, current).href;
        hops += 1;
        if (hops > 5 || seen.has(next)) {
          return result(url, "dead", response.status, hops, next, "Redirect loop, or a chain longer than 5.");
        }
        seen.add(next);
        current = next;
        continue;
      }
      if (method === "HEAD" && (response.status === 405 || response.status === 501 || response.status >= 400)) {
        method = "GET";
        continue;
      }
      return classify(url, current, response.status, hops);
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      return result(url, "unverified", null, hops, null, "Timed out before the host responded.");
    }
    return result(url, "dead", null, hops, null, "Could not resolve or reach the host.");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkMany(urls: string[], options: CheckOptions = {}): Promise<Map<string, LinkStatus>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayMs = options.delayMs ?? 0;
  const concurrency = options.concurrency ?? 4;
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const cache = options.cache ?? globalCache;
  const resultMap = new Map<string, LinkStatus>();
  const pending: string[] = [];

  for (const url of new Set(urls)) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < ttlMs) resultMap.set(url, hit.status);
    else pending.push(url);
  }

  const byHost = new Map<string, string[]>();
  for (const url of pending) {
    let host = "invalid";
    try {
      host = new URL(url).host;
    } catch {
      host = "invalid";
    }
    const list = byHost.get(host) ?? [];
    list.push(url);
    byHost.set(host, list);
  }

  const hosts = [...byHost.keys()];
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= hosts.length) return;
      const host = hosts[index] ?? "";
      const list = byHost.get(host) ?? [];
      for (let i = 0; i < list.length; i += 1) {
        if (i > 0 && delayMs > 0) await sleep(delayMs);
        const url = list[i] ?? "";
        const status = await checkUrl(url, fetchImpl, options.timeoutMs ?? 5_000, options.lookup ?? defaultLookup);
        if (worthCaching(status)) cache.set(url, { at: Date.now(), status });
        resultMap.set(url, status);
      }
    }
  }

  const workers = Math.max(1, Math.min(concurrency, hosts.length || 1));
  await Promise.all(Array.from({ length: hosts.length === 0 ? 0 : workers }, () => worker()));
  return resultMap;
}
