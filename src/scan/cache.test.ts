import { describe, expect, it } from "vitest";
import type { ScanReport } from "@/domain/types";
import { cacheKey, sessionHasImage, writeCachedReport } from "./cache";

describe("review image allowlist", () => {
  it("accepts only an image URL from this session's cached scan", () => {
    const token = `token-${Date.now()}`;
    const report = { cards: [{ preview: { src: "https://cdn.example/a.jpg" } }] } as ScanReport;
    writeCachedReport(cacheKey(token, "org", 7, false), report);
    expect(sessionHasImage(token, "https://cdn.example/a.jpg")).toBe(true);
    expect(sessionHasImage(token, "https://169.254.169.254/latest")).toBe(false);
    expect(sessionHasImage(`other-${token}`, "https://cdn.example/a.jpg")).toBe(false);
  });
});