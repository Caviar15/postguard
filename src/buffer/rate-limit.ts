import type { QuotaWindow } from "@/domain/types";

function splitHeader(value: string): string[] {
  return value
    .split(/,\s*(?=")/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function field(part: string, name: string): string | null {
  const match = part.match(new RegExp(`(?:^|;)\\s*${name}=(\\d+)`));
  return match?.[1] ?? null;
}

/** Parse the RateLimit and RateLimit-Policy headers Buffer sends on every response. */
export function parseRateLimit(rateLimit: string | null, policy: string | null): QuotaWindow[] {
  if (!rateLimit) return [];
  const policies = new Map<string, { quota: number; windowSeconds: number }>();
  if (policy) {
    for (const part of splitHeader(policy)) {
      const name = part.match(/"([^"]+)"/)?.[1];
      const quota = field(part, "q");
      const windowSeconds = field(part, "w");
      if (name && quota && windowSeconds) {
        policies.set(name, { quota: Number(quota), windowSeconds: Number(windowSeconds) });
      }
    }
  }

  return splitHeader(rateLimit).map((part) => {
    const name = part.match(/"([^"]+)"/)?.[1] ?? "unknown";
    const known = policies.get(name);
    return {
      name,
      remaining: Number(field(part, "r") ?? "0"),
      resetSeconds: Number(field(part, "t") ?? "0"),
      quota: known?.quota ?? null,
      windowSeconds: known?.windowSeconds ?? null,
    };
  });
}

export function quotaLabel(windows: QuotaWindow[]): string {
  if (windows.length === 0) return "Rate-limit headers were not on the last response.";
  const order = [900, 86_400, 2_592_000];
  const labels: Record<number, string> = {
    900: "15-minute",
    86400: "24-hour",
    2592000: "30-day",
  };
  const sorted = [...windows].sort((a, b) => {
    const ai = order.indexOf(a.windowSeconds ?? -1);
    const bi = order.indexOf(b.windowSeconds ?? -1);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return sorted
    .map((window) => {
      const name = window.windowSeconds ? (labels[window.windowSeconds] ?? window.name) : window.name;
      const quota = window.quota === null ? "" : ` of ${window.quota}`;
      return `${name}: ${window.remaining}${quota} left`;
    })
    .join(" · ");
}

/** Stop paging when the 15-minute, 24-hour, or 30-day window is down to its last two calls. */
export function shouldStopForQuota(windows: QuotaWindow[]): boolean {
  return windows.some((window) => window.remaining <= 2);
}
