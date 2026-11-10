import { describe, expect, it } from "vitest";
import { blueskyLength, instagramLength, linkedInLength, mastodonLength, mathBold, utf16Length, xLength } from "./text";

describe("character counting", () => {
  it("counts UTF-16 the way Buffer describes emoji, bold, and combining marks", () => {
    expect(utf16Length("Hello")).toBe(5);
    expect(utf16Length(mathBold("Hello"))).toBe(10);
    expect(mathBold("H").codePointAt(0)).toBe(0x1d5db);
    expect(utf16Length("🚀")).toBe(2);
    expect(utf16Length("👨‍👩‍👧")).toBe(8);
    expect(utf16Length("café")).toBe(4);
    expect(utf16Length("cafe\u0301")).toBe(5);
  });

  it("weighs every LinkedIn URL as 24", () => {
    const url = "https://example.com/this/is/a/very/long/path/indeed";
    expect(url.length).toBeGreaterThan(24);
    expect(linkedInLength(url)).toBe(24);
    expect(linkedInLength(`x ${url}`)).toBe(2 + 24);
    expect(linkedInLength("no link")).toBe(7);
  });

  it("counts an Instagram line break as 2", () => {
    expect(instagramLength("a\nb")).toBe(4);
    expect(instagramLength("ab")).toBe(2);
  });

  it("counts Mastodon URLs as 23 and drops the mention server", () => {
    const url = "https://example.com/this/is/long";
    expect(mastodonLength(`hi ${url}`)).toBe(3 + 23);
    expect(mastodonLength("@buffer@threads.net")).toBe("@buffer".length);
  });

  it("counts X and Bluesky the way the character-limits table does", () => {
    expect(xLength("Hello")).toBe(5);
    expect(xLength(mathBold("Hello"))).toBe(10);
    expect(xLength("🚀")).toBe(2);
    expect(xLength("👨‍👩‍👧")).toBe(2);
    expect(xLength("café")).toBe(4);
    expect(xLength("cafe\u0301")).toBe(4);
    expect(xLength("https://example.com/this/is/a/very/long/path")).toBe(23);

    expect(blueskyLength("Hello")).toBe(5);
    expect(blueskyLength(mathBold("Hello"))).toBe(5);
    expect(blueskyLength("🚀")).toBe(1);
    expect(blueskyLength("👨‍👩‍👧")).toBe(1);
    expect(blueskyLength("cafe\u0301")).toBe(4);
    const long = "https://example.com/this/is/a/very/long/path";
    expect(blueskyLength(long)).toBe("example.com".length + 16);
  });
});
