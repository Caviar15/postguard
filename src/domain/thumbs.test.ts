import { describe, expect, it } from "vitest";
import type { Asset } from "./types";
import { cardMedia } from "./thumbs";

function image(source: string, altText: string | null): Asset {
  return { type: "image", source, thumbnail: null, mimeType: "image/jpeg", altText, width: 100, height: 100 };
}

describe("card media", () => {
  it("uses the image alt text, including an empty one", () => {
    const media = cardMedia([
      image("https://cdn.example/a.jpg", null),
      image("https://cdn.example/b.jpg", ""),
      image("https://cdn.example/c.jpg", "image"),
    ]);
    expect(media.extra).toBe(0);
    expect(media.thumbs.map((thumb) => thumb.alt)).toEqual(["", "", "image"]);
    expect(media.thumbs.every((thumb) => thumb.kind === "image")).toBe(true);
  });

  it("shows a video poster and skips a video that has none", () => {
    const media = cardMedia([
      { type: "video", source: "https://cdn.example/a.mp4", thumbnail: null, mimeType: "video/mp4", altText: null, width: 1080, height: 1920 },
      { type: "video", source: "https://cdn.example/b.mp4", thumbnail: "https://cdn.example/b.jpg", mimeType: "video/mp4", altText: null, width: 1080, height: 1920 },
      { type: "document", source: "https://cdn.example/c.pdf", thumbnail: null, mimeType: "application/pdf", altText: null, width: null, height: null },
      image("", "ignored"),
    ]);
    expect(media.thumbs).toEqual([{ src: "https://cdn.example/b.jpg", alt: "", kind: "video" }]);
    expect(media.extra).toBe(0);
  });

  it("keeps three pictures and counts the rest", () => {
    const media = cardMedia([
      image("https://cdn.example/1.jpg", "one"),
      image("https://cdn.example/2.jpg", "two"),
      image("https://cdn.example/3.jpg", "three"),
      image("https://cdn.example/4.jpg", "four"),
      image("https://cdn.example/5.jpg", "five"),
    ]);
    expect(media.thumbs).toHaveLength(3);
    expect(media.thumbs[2]?.alt).toBe("three");
    expect(media.extra).toBe(2);
  });
});
