import { describe, expect, it } from "vitest";
import type { LinkStatus } from "@/domain/types";
import { makeChannel, makePost } from "@/test/factory";
import { runRules } from "./engine";
import { mathBold } from "./text";

const NOW = new Date("2026-11-10T12:00:00.000Z");

function run(
  posts: ReturnType<typeof makePost>[],
  channels = [makeChannel()],
  links: LinkStatus[] = [],
) {
  return runRules({
    posts,
    channels,
    linkResults: new Map(links.map((status) => [status.url, status])),
    now: NOW,
  });
}

describe("dead-link", () => {
  const url = "https://shop.example/gone";
  const post = makePost({ text: `see ${url}`, service: "twitter" });

  it("flags 4xx as a blocker and leaves a healthy link alone", () => {
    const findings = run([post], [makeChannel({ service: "twitter" })], [
      { url, outcome: "dead", status: 404, hops: 0, finalUrl: url, detail: "HTTP 404." },
    ]);
    expect(findings.map((finding) => finding.ruleId)).toContain("dead-link");
    expect(findings.find((finding) => finding.ruleId === "dead-link")?.severity).toBe("blocker");
  });

  it("treats a long chain, a soft 404, and http as medium, and 403 as unverified", () => {
    for (const outcome of ["redirect", "soft-404", "insecure"] as const) {
      const findings = run([post], [makeChannel({ service: "twitter" })], [
        { url, outcome, status: 200, hops: 4, finalUrl: "https://shop.example/", detail: outcome },
      ]);
      expect(findings.find((finding) => finding.ruleId === "dead-link")?.severity).toBe("medium");
    }
    const unverified = run([post], [makeChannel({ service: "twitter" })], [
      { url, outcome: "unverified", status: 403, hops: 0, finalUrl: url, detail: "HTTP 403." },
    ]);
    expect(unverified.find((finding) => finding.ruleId === "dead-link")?.severity).toBe("low");
  });
});

describe("media-url", () => {
  it("flags signed, Drive, and unreachable media", () => {
    const signed = "https://bucket.s3.amazonaws.com/a.jpg?X-Amz-Expires=60&X-Amz-Signature=abc";
    const drive = "https://drive.google.com/file/d/abc/view";
    const gone = "https://cdn.example/missing.jpg";
    const findings = run([
      makePost({
        assets: [
          { type: "image", source: signed, thumbnail: null, mimeType: "image/jpeg", altText: "linen", width: 1000, height: 1000 },
          { type: "image", source: drive, thumbnail: null, mimeType: "image/jpeg", altText: "linen", width: 1000, height: 1000 },
          { type: "image", source: gone, thumbnail: null, mimeType: "image/jpeg", altText: "linen", width: 1000, height: 1000 },
        ],
      }),
    ], [makeChannel()], [
      { url: gone, outcome: "dead", status: 404, hops: 0, finalUrl: gone, detail: "HTTP 404." },
    ]);
    const media = findings.filter((finding) => finding.ruleId === "media-url");
    expect(media).toHaveLength(3);
    expect(media.every((finding) => finding.severity === "blocker")).toBe(true);
  });
});

describe("text-length", () => {
  it("blocks an over-long post and warns inside 5%", () => {
    const over = run([makePost({ service: "twitter", text: "a".repeat(281) })], [makeChannel({ service: "twitter", twitterSubscription: "free" })]);
    expect(over.find((finding) => finding.ruleId === "text-length")?.severity).toBe("blocker");
    const near = run([makePost({ service: "twitter", text: "a".repeat(270) })], [makeChannel({ service: "twitter", twitterSubscription: "none" })]);
    expect(near.find((finding) => finding.ruleId === "text-length")?.severity).toBe("medium");
    const premium = run(
      [makePost({ service: "twitter", text: "a".repeat(281) })],
      [makeChannel({ service: "twitter", twitterSubscription: "premium" })],
    );
    expect(premium.some((finding) => finding.ruleId === "text-length")).toBe(false);
  });

  it("uses the Mastodon server limit and LinkedIn URL weight", () => {
    const url = "https://example.com/this/is/a/very/long/path/that/would/not/fit";
    const text = `${"a".repeat(280)} ${url}`;
    const findings = run(
      [makePost({ service: "linkedin", text })],
      [makeChannel({ service: "linkedin" })],
    );
    expect(findings.some((finding) => finding.ruleId === "text-length" && finding.severity === "blocker")).toBe(false);

    const mastodon = run(
      [makePost({ service: "mastodon", text: "a".repeat(180) })],
      [makeChannel({ service: "mastodon", maxCharacters: 150 })],
    );
    expect(mastodon.find((finding) => finding.ruleId === "text-length")?.severity).toBe("blocker");
  });

  it("blocks angle brackets in a YouTube description unless it is a reminder", () => {
    const blocked = run([makePost({ service: "youtube", text: "a < b" })], [makeChannel({ service: "youtube" })]);
    expect(blocked.some((finding) => finding.title.includes("YouTube description"))).toBe(true);
    const reminder = run(
      [makePost({ service: "youtube", text: "a < b", schedulingType: "notification" })],
      [makeChannel({ service: "youtube" })],
    );
    expect(reminder.some((finding) => finding.title.includes("YouTube description"))).toBe(false);
  });

  it("counts Instagram line breaks toward the 2196 limit", () => {
    const text = `${"a".repeat(2196)}\n`;
    const findings = run([makePost({ service: "instagram", text })], [makeChannel({ service: "instagram" })]);
    expect(findings.find((finding) => finding.ruleId === "text-length")?.severity).toBe("blocker");
  });
});

describe("fake-bold", () => {
  it("warns when Unicode bold spends the budget", () => {
    const findings = run([makePost({ text: mathBold("Hello studio") })]);
    expect(findings.some((finding) => finding.ruleId === "fake-bold")).toBe(true);
    expect(run([makePost({ text: "Hello studio" })]).some((finding) => finding.ruleId === "fake-bold")).toBe(false);
  });
});

describe("first-comment", () => {
  it("flags an empty comment promised by the caption, an over-long comment, and a dead link", () => {
    const url = "https://shop.example/gone";
    const findings = run(
      [
        makePost({
          id: "empty",
          service: "instagram",
          hasFirstCommentField: true,
          firstComment: "",
          text: "Link in the comments.",
        }),
        makePost({
          id: "long",
          service: "linkedin",
          hasFirstCommentField: true,
          firstComment: "a".repeat(1300),
          text: "Notes",
        }),
        makePost({
          id: "dead",
          service: "facebook",
          hasFirstCommentField: true,
          firstComment: `buy ${url}`,
          text: "New dyes",
        }),
      ],
      [makeChannel({ service: "instagram" })],
      [{ url, outcome: "dead", status: 404, hops: 0, finalUrl: url, detail: "HTTP 404." }],
    );
    const comments = findings.filter((finding) => finding.ruleId === "first-comment");
    expect(comments.map((finding) => finding.severity).sort()).toEqual(["blocker", "high", "high"]);
  });

  it("does not invent a first comment on networks that have no field", () => {
    const findings = run([makePost({ service: "threads", text: "Link in the comments.", hasFirstCommentField: false, firstComment: null })]);
    expect(findings.some((finding) => finding.ruleId === "first-comment")).toBe(false);
  });
});

describe("field-limits", () => {
  it("blocks long titles and a Threads topic with & or a period", () => {
    const findings = run([
      makePost({ service: "pinterest", title: "a".repeat(101), text: "pin" }),
      makePost({ id: "yt", service: "youtube", title: "a < b", text: "video" }),
      makePost({ id: "th", service: "threads", topic: "spring & summer.", text: "note" }),
    ]);
    const fields = findings.filter((finding) => finding.ruleId === "field-limits");
    expect(fields.length).toBeGreaterThanOrEqual(3);
    expect(fields.every((finding) => finding.severity === "blocker")).toBe(true);
  });
});

describe("thread-length", () => {
  it("applies the same limit to each thread item", () => {
    const findings = run(
      [makePost({ service: "bluesky", text: "root", thread: [{ text: "a".repeat(301) }, { text: "ok" }] })],
      [makeChannel({ service: "bluesky" })],
    );
    const items = findings.filter((finding) => finding.ruleId === "thread-length");
    expect(items).toHaveLength(1);
    expect(items[0]?.severity).toBe("blocker");
  });
});

describe("aspect-ratio", () => {
  it("flags a portrait image on an Instagram feed post and ignores missing dimensions", () => {
    const findings = run([
      makePost({
        service: "instagram",
        postType: "post",
        assets: [
          { type: "image", source: "https://cdn.example/a.jpg", thumbnail: null, mimeType: "image/jpeg", altText: "hem", width: 1080, height: 1920 },
          { type: "image", source: "https://cdn.example/b.jpg", thumbnail: null, mimeType: "image/jpeg", altText: "hem", width: 0, height: 0 },
        ],
      }),
    ]);
    const aspect = findings.filter((finding) => finding.ruleId === "aspect-ratio");
    expect(aspect).toHaveLength(1);
    expect(aspect[0]?.advisory).toBe(true);
    expect(aspect[0]?.severity).toBe("high");
  });
});

describe("alt-text", () => {
  it("flags a missing alt, a filename, and a short caption on video", () => {
    const findings = run([
      makePost({
        text: "Hi",
        assets: [
          { type: "image", source: "https://cdn.example/a.jpg", thumbnail: null, mimeType: "image/jpeg", altText: "", width: 1080, height: 1080 },
          { type: "image", source: "https://cdn.example/b.jpg", thumbnail: null, mimeType: "image/jpeg", altText: "IMG_2044.jpg", width: 1080, height: 1080 },
          { type: "video", source: "https://cdn.example/c.mp4", thumbnail: null, mimeType: "video/mp4", altText: null, width: 1080, height: 1920 },
        ],
      }),
    ]);
    expect(findings.filter((finding) => finding.ruleId === "alt-text")).toHaveLength(1);
    expect(findings.some((finding) => finding.ruleId === "weak-alt")).toBe(true);
    expect(findings.some((finding) => finding.ruleId === "video-alt")).toBe(true);
  });
});

describe("duplicates", () => {
  const text = "The linen series is back in the studio this week. Same cloth, new dye lot.";

  it("marks a same-channel pair inside 24 hours as high and a cross-post inside an hour as medium", () => {
    const same = run([
      makePost({ id: "a", text, dueAt: "2026-11-12T10:00:00.000Z" }),
      makePost({ id: "b", text: `${text} https://example.com/linen`, dueAt: "2026-11-12T18:00:00.000Z" }),
    ]);
    expect(same.find((finding) => finding.ruleId === "duplicate")?.severity).toBe("high");

    const cross = run(
      [
        makePost({ id: "a", channelId: "c1", text, dueAt: "2026-11-12T10:00:00.000Z" }),
        makePost({ id: "b", channelId: "c2", service: "twitter", text, dueAt: "2026-11-12T10:30:00.000Z" }),
      ],
      [makeChannel(), makeChannel({ id: "c2", service: "twitter" })],
    );
    expect(cross.find((finding) => finding.ruleId === "duplicate")?.severity).toBe("medium");
  });

  it("does not flag a cross-post more than an hour apart", () => {
    const findings = run(
      [
        makePost({ id: "a", channelId: "c1", text, dueAt: "2026-11-12T10:00:00.000Z" }),
        makePost({ id: "b", channelId: "c2", text, dueAt: "2026-11-13T10:00:00.000Z" }),
      ],
      [makeChannel(), makeChannel({ id: "c2", service: "twitter" })],
    );
    expect(findings.some((finding) => finding.ruleId === "duplicate")).toBe(false);
  });
});

describe("channel health", () => {
  it("blocks a disconnected or locked channel with queued posts and notes a pause", () => {
    const findings = run(
      [makePost()],
      [makeChannel({ isDisconnected: true, isLocked: true, isQueuePaused: true })],
    );
    expect(findings.find((finding) => finding.ruleId === "channel-disconnected")?.severity).toBe("blocker");
    expect(findings.find((finding) => finding.ruleId === "channel-locked")?.severity).toBe("blocker");
    expect(findings.find((finding) => finding.ruleId === "channel-paused")?.severity).toBe("info");
  });

  it("stays quiet when the unhealthy channel has nothing queued", () => {
    const findings = run([], [makeChannel({ isDisconnected: true })]);
    expect(findings).toHaveLength(0);
  });
});

describe("schedule, placeholders, and hashtags", () => {
  it("flags overdue posts, recorded errors, and notification posts", () => {
    const findings = run([
      makePost({ dueAt: "2026-11-10T09:00:00.000Z", status: "scheduled" }),
      makePost({ id: "err", errorMessage: "Channel disconnected at publish." }),
      makePost({ id: "note", schedulingType: "notification", text: "Publish this by hand" }),
    ]);
    expect(findings.find((finding) => finding.ruleId === "schedule")?.severity).toBe("high");
    expect(findings.find((finding) => finding.ruleId === "publishing-error")?.severity).toBe("high");
    expect(findings.find((finding) => finding.ruleId === "notification-post")?.severity).toBe("info");
  });

  it("flags placeholder copy", () => {
    const findings = run([makePost({ text: "TODO swap [link] before Friday {{name}}" })]);
    expect(findings.find((finding) => finding.ruleId === "placeholder")?.severity).toBe("high");
  });

  it("flags more than 30 Instagram hashtags and a broken hash", () => {
    const tags = Array.from({ length: 31 }, (_, index) => `#dye${index}`).join(" ");
    const findings = run(
      [makePost({ service: "instagram", text: tags }), makePost({ id: "broken", text: "See # this" })],
      [makeChannel({ service: "instagram" })],
    );
    const hashes = findings.filter((finding) => finding.ruleId === "hashtags");
    expect(hashes.some((finding) => finding.severity === "high")).toBe(true);
    expect(hashes.some((finding) => finding.severity === "low")).toBe(true);
  });
});
