import { describe, expect, it } from "vitest";
import { parseReview, takeReviewSlot } from "./review";

describe("AI review guardrails", () => {
  it("parses a suggestion and rejects a short or broken reply", () => {
    expect(parseReview('Sure. {"altText":"Walnut-dyed linen folded on a table.","mismatch":null}')).toEqual({
      altText: "Walnut-dyed linen folded on a table.",
      mismatch: null,
    });
    expect(parseReview('{"altText":"short","mismatch":"no"}')).toBeNull();
    expect(parseReview("not json")).toBeNull();
  });

  it("stops after the hourly cap", () => {
    const key = `cap-${Date.now()}`;
    for (let i = 0; i < 6; i += 1) expect(takeReviewSlot(key, 1_000)).toBe(true);
    expect(takeReviewSlot(key, 1_000)).toBe(false);
    expect(takeReviewSlot(key, 1_000 + 61 * 60 * 1000)).toBe(true);
  });
});
