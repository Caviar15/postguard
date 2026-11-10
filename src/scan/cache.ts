import { createHash } from "node:crypto";
import type { ScanReport } from "@/domain/types";

type Entry = { at: number; report: ScanReport };

const store = new Map<string, Entry>();
const TTL_MS = 10 * 60 * 1000;

export function cacheKey(refreshToken: string, organizationId: string, windowDays: number): string {
  const hash = createHash("sha256").update(refreshToken).digest("hex").slice(0, 16);
  return `${hash}:${organizationId}:${windowDays}`;
}

export function readCachedReport(key: string): ScanReport | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  return { ...entry.report, cached: true };
}

export function writeCachedReport(key: string, report: ScanReport): void {
  store.set(key, { at: Date.now(), report: { ...report, cached: false } });
}
