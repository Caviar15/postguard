import { createHash } from "node:crypto";
import type { ScanReport } from "@/domain/types";

type Entry = { at: number; report: ScanReport };

const store = new Map<string, Entry>();
const TTL_MS = 10 * 60 * 1000;

export function cacheKey(tokenMaterial: string, organizationId: string, windowDays: number, includeDrafts = false): string {
  const hash = createHash("sha256").update(tokenMaterial).digest("hex").slice(0, 16);
  return `${hash}:${organizationId}:${windowDays}:${includeDrafts ? "drafts" : "queue"}`;
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

/** True when this session's unexpired scan cache contains the image URL exactly. */
export function sessionHasImage(tokenMaterial: string, imageUrl: string, now = Date.now()): boolean {
  const prefix = `${createHash("sha256").update(tokenMaterial).digest("hex").slice(0, 16)}:`;
  for (const [key, entry] of store) {
    if (!key.startsWith(prefix)) continue;
    if (now - entry.at > TTL_MS) continue;
    if (entry.report.cards.some((card) => card.preview?.src === imageUrl)) return true;
  }
  return false;
}
