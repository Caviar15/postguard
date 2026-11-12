/** Critical tests: URL extraction. Drop into src/critical/urls.test.ts */
import { describe, expect, it } from "vitest";
import { extractUrls } from "@/domain/urls";

describe("URL extraction", () => {
  it("keeps a balanced closing parenthesis (Wikipedia style URLs)", () => {
    expect(extractUrls("Read https://en.wikipedia.org/wiki/Rust_(programming_language) today")).toEqual([
      "https://en.wikipedia.org/wiki/Rust_(programming_language)",
    ]);
  });
  it("keeps an apostrophe inside a path", () => {
    expect(extractUrls("see https://example.com/it's-here now")).toEqual(["https://example.com/it's-here"]);
  });
  it("still drops sentence punctuation and wrapping brackets", () => {
    expect(extractUrls("(see https://a.example/x), and https://b.example/y.")).toEqual(["https://a.example/x", "https://b.example/y"]);
    expect(extractUrls("[docs](https://a.example/d)")).toEqual(["https://a.example/d"]);
  });
  it("does not blow up on a 200k-character URL-ish string", () => {
    const t0 = Date.now();
    extractUrls(`https://a.example/${"a".repeat(200_000)}`);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
